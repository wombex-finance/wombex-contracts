// SPDX-License-Identifier: MIT
pragma solidity ^0.8.5;

import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import '../Interfaces.sol';
import "hardhat/console.sol";

contract WombatVoter {
    struct GaugeInfo {
        uint104 supplyBaseIndex; // 19.12 fixed point. distributed reward per alloc point
        uint104 supplyVoteIndex; // 19.12 fixed point. distributed reward per vote weight
        uint40 nextEpochStartTime;
        uint128 claimable; // 20.18 fixed point. Rewards pending distribution in the next epoch
        bool whitelist;
        IGauge gaugeManager;
        IBribe bribe; // address of bribe
    }

    struct GaugeWeight {
        uint128 allocPoint;
        uint128 voteWeight; // total amount of votes for an LP-token
    }

    uint256 internal constant ACC_TOKEN_PRECISION = 1e12;
    uint256 internal constant EPOCH_DURATION = 7 days;

    IERC20 public wom;
    IVe public veWom;
    IERC20[] public lpTokens; // all LP tokens

    // emission related storage
    uint40 public lastRewardTimestamp; // last timestamp to count
    uint104 public baseIndex; // 19.12 fixed point. Accumulated reward per alloc point
    uint104 public voteIndex; // 19.12 fixed point. Accumulated reward per vote weight

    uint128 public totalWeight;
    uint128 public totalAllocPoint;

    uint40 public firstEpochStartTime;
    uint88 public womPerSec; // 8.18 fixed point
    uint16 public baseAllocation; // (e.g. 300 for 30%)

    mapping(IERC20 => GaugeWeight) public weights; // lpToken => gauge weight
    mapping(address => mapping(IERC20 => uint256)) public votes; // user address => lpToken => votes
    mapping(IERC20 => GaugeInfo) public infos; // lpToken => GaugeInfo

    event UpdateEmissionPartition(uint256 baseAllocation, uint256 votePartition);
    event UpdateVote(address user, IERC20 lpToken, uint256 amount);
    event DistributeReward(IERC20 lpToken, uint256 amount);

    constructor(
        IERC20 _wom,
        IVe _veWom,
        uint88 _womPerSec,
        uint40 _startTimestamp,
        uint40 _firstEpochStartTime,
        uint16 _baseAllocation
    ) {
        require(_firstEpochStartTime >= block.timestamp, 'invalid _firstEpochStartTime');
        require(address(_wom) != address(0), 'wom address cannot be zero');
        require(address(_veWom) != address(0), 'veWom address cannot be zero');
        require(_baseAllocation <= 1000);
        require(_womPerSec <= 10000e18);

        wom = _wom;
        veWom = _veWom;
        womPerSec = _womPerSec;
        lastRewardTimestamp = _startTimestamp;
        firstEpochStartTime = _firstEpochStartTime;
        baseAllocation = _baseAllocation;
    }

    /// @dev this check save more gas than a modifier
    function _checkGaugeExist(IERC20 _lpToken) internal view {
        require(address(infos[_lpToken].gaugeManager) != address(0), 'Voter: gaugeManager not exist');
    }

    /// @notice returns LP tokens length
    function lpTokenLength() external view returns (uint256) {
        return lpTokens.length;
    }

    /// @notice getter function to return vote of a LP token for a user
    function getUserVotes(address _user, IERC20 _lpToken) external view returns (uint256) {
        return votes[_user][_lpToken];
    }

    /// @notice Vote and unvote WOM emission for LP tokens.
    /// User can vote/unvote a un-whitelisted pool. But no WOM will be emitted.
    /// Bribes are also distributed by the Bribe contract.
    /// Amount of vote should be checked by veWom.vote().
    /// This can also used to distribute bribes when _deltas are set to 0
    /// @param _lpVote address to LP tokens to vote
    /// @param _deltas change of vote for each LP tokens
    function vote(
        IERC20[] calldata _lpVote,
        int256[] calldata _deltas
    ) external returns (uint256[][] memory bribeRewards) {
        // 1. call _updateFor() to update WOM emission
        // 2. update related lpToken weight and total lpToken weight
        // 3. update used voting power and ensure there's enough voting power
        // 4. call IBribe.onVote() to update bribes
        console.log("1");
        require(_lpVote.length == _deltas.length, 'voter: array length not equal');

        // update voteIndex
        console.log("2");
        _distributeWom();

        console.log("3");
        uint256 voteCnt = _lpVote.length;
        int256 voteDelta;

        console.log("4");
        bribeRewards = new uint256[][](voteCnt);

        console.log("5");
        for (uint256 i; i < voteCnt; ++i) {
            IERC20 lpToken = _lpVote[i];
            console.log("6");
            _checkGaugeExist(lpToken);

            console.log("7");
            int256 delta = _deltas[i];
            uint256 originalWeight = weights[lpToken].voteWeight;
            console.log("8");
            if (delta != 0) {
                console.log("9");
                _updateFor(lpToken);
                console.log("10");

                // update vote and weight
                if (delta > 0) {
                    // vote
                    console.log("10 1");
                    votes[msg.sender][lpToken] += uint256(delta);
                    console.log("10 2");
                    weights[lpToken].voteWeight = to128(originalWeight + uint256(delta));
                    console.log("10 3");
                    totalWeight += to128(uint256(delta));
                } else {
                    // unvote
                    console.log("10 4");
                    require(votes[msg.sender][lpToken] >= uint256(-delta), 'voter: vote underflow');
                    console.log("10 5");
                    votes[msg.sender][lpToken] -= uint256(-delta);
                    console.log("10 6");
                    weights[lpToken].voteWeight = to128(originalWeight - uint256(-delta));
                    console.log("10 7");
                    totalWeight -= to128(uint256(-delta));
                }

                console.log("10 8");
                voteDelta += delta;
                emit UpdateVote(msg.sender, lpToken, votes[msg.sender][lpToken]);
            }

            console.log("10 9");
            // update bribe
            if (address(infos[lpToken].bribe) != address(0)) {
                bribeRewards[i] = infos[lpToken].bribe.onVote(msg.sender, votes[msg.sender][lpToken], originalWeight);
            }
        }

        // notice veWom for the new vote, it reverts if vote is invalid
        console.log("11 voteDelta", uint256(voteDelta));
        veWom.vote(msg.sender, voteDelta);
        console.log("12");
    }

    /// @notice Claim bribes for LP tokens
    /// @dev This function looks safe from re-entrancy attack
    function claimBribes(IERC20[] calldata _lpTokens) external returns (uint256[][] memory bribeRewards) {
        bribeRewards = new uint256[][](_lpTokens.length);
        for (uint256 i; i < _lpTokens.length; ++i) {
            IERC20 lpToken = _lpTokens[i];
            _checkGaugeExist(lpToken);
            if (address(infos[lpToken].bribe) != address(0)) {
                bribeRewards[i] = infos[lpToken].bribe.onVote(
                    msg.sender,
                    votes[msg.sender][lpToken],
                    weights[lpToken].voteWeight
                );
            }
        }
    }

    /// @dev This function looks safe from re-entrancy attack
    function distribute(IERC20 _lpToken) external {
        require(msg.sender == address(infos[_lpToken].gaugeManager), 'Caller is not gauge manager');
        _checkGaugeExist(_lpToken);
        _distributeWom();
        _updateFor(_lpToken);

        uint256 _claimable = infos[_lpToken].claimable;
        // 1. distribute WOM once in each epoch
        // 2. In case WOM is not fueled, it should not create DoS
        if (
            _claimable > 0 &&
            block.timestamp >= infos[_lpToken].nextEpochStartTime &&
            wom.balanceOf(address(this)) > _claimable
        ) {
            infos[_lpToken].claimable = 0;
            infos[_lpToken].nextEpochStartTime = _getNextEpochStartTime();
            emit DistributeReward(_lpToken, _claimable);

            wom.transfer(address(infos[_lpToken].gaugeManager), _claimable);
            infos[_lpToken].gaugeManager.notifyRewardAmount(_lpToken, _claimable);
        }
    }

    /// @notice Update index for accrued WOM
    function _distributeWom() internal {
        if (block.timestamp <= lastRewardTimestamp) {
            return;
        }

        baseIndex = to104(_getBaseIndex());
        voteIndex = to104(_getVoteIndex());
        lastRewardTimestamp = uint40(block.timestamp);
    }

    /// @notice Update `supplyBaseIndex` and `supplyVoteIndex` for the gauge
    /// @dev Assumption: gaugeManager exists and is not paused, the caller should verify it
    /// @param _lpToken address of the LP token
    function _updateFor(IERC20 _lpToken) internal {
        // calculate claimable amount before update supplyVoteIndex
        infos[_lpToken].claimable = to128(_getClaimable(_lpToken, baseIndex, voteIndex));
        infos[_lpToken].supplyBaseIndex = baseIndex;
        infos[_lpToken].supplyVoteIndex = voteIndex;
    }

    /**
     * Permisioneed functions
     */

    /// @notice update the base and vote partition
    function setBaseAllocation(uint16 _baseAllocation) external {
        require(_baseAllocation <= 1000);
        _distributeWom();

        emit UpdateEmissionPartition(_baseAllocation, 1000 - _baseAllocation);
        baseAllocation = _baseAllocation;
    }

    function setAllocPoint(IERC20 _lpToken, uint128 _allocPoint) external {
        _distributeWom();
        _updateFor(_lpToken);
        totalAllocPoint = totalAllocPoint - weights[_lpToken].allocPoint + _allocPoint;
        weights[_lpToken].allocPoint = _allocPoint;
    }

    /// @notice Add LP token into the Voter
    function add(IGauge _gaugeManager, IERC20 _lpToken, IBribe _bribe) external {
        require(infos[_lpToken].whitelist == false, 'voter: already added');
        require(address(_gaugeManager) != address(0));
        require(address(_lpToken) != address(0));
        require(address(infos[_lpToken].gaugeManager) == address(0), 'Voter: gaugeManager is already exist');

        infos[_lpToken].whitelist = true;
        infos[_lpToken].gaugeManager = _gaugeManager;
        infos[_lpToken].bribe = _bribe; // 0 address is allowed
        infos[_lpToken].nextEpochStartTime = _getNextEpochStartTime();
        lpTokens.push(_lpToken);
    }

    function setWomPerSec(uint88 _womPerSec) external {
        require(_womPerSec <= 10000e18, 'reward rate too high'); // in case `voteIndex` overflow
        _distributeWom();
        womPerSec = _womPerSec;
    }

    /// @notice Pause vote emission of WOM tokens for the gauge.
    /// Users can still vote/unvote and receive bribes.
    function pauseVoteEmission(IERC20 _lpToken) external {
        require(infos[_lpToken].whitelist, 'voter: not whitelisted');
        _checkGaugeExist(_lpToken);

        _distributeWom();
        _updateFor(_lpToken);

        infos[_lpToken].whitelist = false;
    }

    /// @notice Resume vote accumulation of WOM tokens for the gauge.
    function resumeVoteEmission(IERC20 _lpToken) external {
        require(infos[_lpToken].whitelist == false, 'voter: not paused');
        _checkGaugeExist(_lpToken);

        // catch up supplyVoteIndex
        _distributeWom();
        _updateFor(_lpToken);

        infos[_lpToken].whitelist = true;
    }

    /// @notice get gaugeManager address for LP token
    function setGauge(IERC20 _lpToken, IGauge _gaugeManager) external {
        require(address(_gaugeManager) != address(0));
        _checkGaugeExist(_lpToken);

        infos[_lpToken].gaugeManager = _gaugeManager;
    }

    /// @notice get bribe address for LP token
    function setBribe(IERC20 _lpToken, IBribe _bribe) external {
        _checkGaugeExist(_lpToken);

        infos[_lpToken].bribe = _bribe; // 0 address is allowed
    }

    /// @notice In case we need to manually migrate WOM funds from Voter
    /// Sends all remaining wom from the contract to the owner
    function emergencyWomWithdraw() external {
        // SafeERC20 is not needed as WOM will revert if transfer fails
        wom.transfer(address(msg.sender), wom.balanceOf(address(this)));
    }

    /**
     * Read-only functions
     */

    function voteAllocation() external view returns (uint256) {
        return 1000 - baseAllocation;
    }

    /// @notice Get pending bribes for LP tokens
    function pendingBribes(
        IERC20[] calldata _lpTokens,
        address _user
    )
    external
    view
    returns (
        IERC20[][] memory bribeTokenAddresses,
        string[][] memory bribeTokenSymbols,
        uint256[][] memory bribeRewards
    )
    {
        bribeTokenAddresses = new IERC20[][](_lpTokens.length);
        bribeTokenSymbols = new string[][](_lpTokens.length);
        bribeRewards = new uint256[][](_lpTokens.length);
        for (uint256 i; i < _lpTokens.length; ++i) {
            IERC20 lpToken = _lpTokens[i];
            if (address(infos[lpToken].bribe) != address(0)) {
                bribeRewards[i] = infos[lpToken].bribe.pendingTokens(_user);
                bribeTokenAddresses[i] = infos[lpToken].bribe.rewardTokens();

                uint256 len = bribeTokenAddresses[i].length;
                bribeTokenSymbols[i] = new string[](len);

                for (uint256 j; j < len; ++j) {
                    if (address(bribeTokenAddresses[i][j]) == address(0)) {
                        bribeTokenSymbols[i][j] = 'BNB';
                    } else {
                        bribeTokenSymbols[i][j] = IERC20Metadata(address(bribeTokenAddresses[i][j])).symbol();
                    }
                }
            }
        }
    }

    /// @notice Amount of pending WOM for the LP token
    function pendingWom(IERC20 _lpToken) external view returns (uint256) {
        return _getClaimable(_lpToken, _getBaseIndex(), _getVoteIndex());
    }

    function _getBaseIndex() internal view returns (uint256) {
        if (block.timestamp <= lastRewardTimestamp || totalAllocPoint == 0) {
            return baseIndex;
        }

        uint256 secondsElapsed = block.timestamp - lastRewardTimestamp;
        // use `max(totalAllocPoint, 1e18)` in case the value overflows uint104
        return
        baseIndex +
        (secondsElapsed * womPerSec * baseAllocation * ACC_TOKEN_PRECISION) /
        max(totalAllocPoint, 1e18) /
        1000;
    }

    /// @notice Calculate the latest value of `voteIndex`
    function _getVoteIndex() internal view returns (uint256) {
        if (block.timestamp <= lastRewardTimestamp || totalWeight == 0) {
            return voteIndex;
        }

        uint256 secondsElapsed = block.timestamp - lastRewardTimestamp;
        // use `max(totalWeight, 1e18)` in case the value overflows uint104
        return
        voteIndex +
        (secondsElapsed * womPerSec * (1000 - baseAllocation) * ACC_TOKEN_PRECISION) /
        max(totalWeight, 1e18) /
        1000;
    }

    /// @notice Calculate the latest amount of `claimable` for a gauge
    function _getClaimable(IERC20 _lpToken, uint256 _baseIndex, uint256 _voteIndex) internal view returns (uint256) {
        uint256 baseIndexDelta = _baseIndex - infos[_lpToken].supplyBaseIndex;
        uint256 _baseShare = (weights[_lpToken].allocPoint * baseIndexDelta) / ACC_TOKEN_PRECISION;

        if (!infos[_lpToken].whitelist) {
            return infos[_lpToken].claimable + _baseShare;
        }

        uint256 voteIndexDelta = _voteIndex - infos[_lpToken].supplyVoteIndex;
        uint256 _voteShare = (weights[_lpToken].voteWeight * voteIndexDelta) / ACC_TOKEN_PRECISION;

        return infos[_lpToken].claimable + _baseShare + _voteShare;
    }

    /// @notice Get the start timestamp of the next epoch
    function _getNextEpochStartTime() internal view returns (uint40) {
        if (block.timestamp < firstEpochStartTime) {
            return firstEpochStartTime;
        }

        uint256 epochCount = (block.timestamp - firstEpochStartTime) / EPOCH_DURATION;
        return uint40(firstEpochStartTime + (epochCount + 1) * EPOCH_DURATION);
    }

    function to128(uint256 val) internal pure returns (uint128) {
        require(val <= type(uint128).max, 'uint128 overflow');
        return uint128(val);
    }

    function to104(uint256 val) internal pure returns (uint104) {
        if (val > type(uint104).max) revert('uint104 overflow');
        return uint104(val);
    }

    function max(uint256 x, uint256 y) internal pure returns (uint256) {
        return x >= y ? x : y;
    }
}
