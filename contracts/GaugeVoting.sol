// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";

/**
 * @title   GaugeVoting
 * @author  WombexFinance
 */
contract GaugeVoting is Ownable {
    uint256 public constant DENOMINATOR = 10000;

    IWmxLocker public wmxLocker;
    IBooster public booster;
    IBribeVoter public bribeVoter;
    address public voterProxy;
    IERC20 public veWom;

    ITokenFactory tokenFactory;
    IBribesRewardFactory bribeRewardsFactory;

    mapping(address => uint256) userVotes;
    mapping(address => address) lpTokenRewards;

    enum LpTokenStatus {
        NOT_EXISTS,
        ADDED,
        ACTIVE
    }
    mapping(address => LpTokenStatus) lpTokenStatus;
    address[] lpTokensAdded;

    ITokenMinter stakingToken;
    uint256 lastVoteAt;
    uint256 votePeriod;
    uint256 voteIncentive;
    uint256 voteThreshold;
    bool executeOnVote;

    event SetVotingConfig(uint256 votePeriod, uint256 voteThreshold, uint256 voteIncentive, bool executeOnVote);
    event SetFactories(address tokenFactory, address rewardFactory);
    event AddLpToken(address lpToken, address rewards);
    event SetLpTokenStatus(address lpToken, LpTokenStatus status);

    constructor(
        IWmxLocker _wmxLocker,
        IBooster _booster,
        IBribeVoter _bribeVoter
    ) public {
        wmxLocker = _wmxLocker;
        booster = _booster;
        voterProxy = _booster.voterProxy();
        veWom = IERC20(IStaker(voterProxy).veWom());
        bribeVoter = _bribeVoter;
    }

    function setVotingConfig(uint256 _votePeriod, uint256 _voteThreshold, uint256 _voteIncentive, bool _executeOnVote) public onlyOwner {
        votePeriod = _votePeriod;
        voteThreshold = _voteThreshold;
        voteIncentive = _voteIncentive;
        executeOnVote = _executeOnVote;
        emit SetVotingConfig(_votePeriod, _voteThreshold, _voteIncentive, _executeOnVote);
    }

    function setFactories(address _tokenFactory, address _rewardFactory, address _stakingToken) public onlyOwner {
        require(tokenFactory == address(0), "!zero");
        tokenFactory = ITokenFactory(_tokenFactory);
        bribeRewardsFactory = IBribesRewardFactory(_rewardFactory);

        if (_stakingToken == address(0)) {
            stakingToken = ITokenMinter(tokenFactory.CreateDepositToken(address(wmxLocker)));
        } else {
            stakingToken = _stakingToken;
        }

        emit SetFactories(_tokenFactory, _rewardFactory);
    }

    function registerLpTokens(address[] _lpTokens) external onlyOwner {
        uint256 len = _lpTokens.length;
        for (uint256 i = 0; i < len; i++) {
            _registerLpToken(_lpTokens[i]);
        }
    }

    function registerCreatedLpTokens(address[] _lpTokens, address[] rewards) external onlyOwner {
        uint256 len = _lpTokens.length;
        require(len == rewards.length, "!len");
        for (uint256 i = 0; i < len; i++) {
            _registerCreatedLpToken(_lpTokens[i], rewards[i]);
        }
    }

    function _registerLpToken(address _lpToken) internal {
        _registerCreatedLpToken(_lpToken, bribeRewardsFactory.CreateBribesRewards(stakingToken, _lpToken));
    }

    function _registerCreatedLpToken(address _lpToken, address _rewards) internal {
        require(lpTokenStatus[_lpToken] == LpTokenStatus.NOT_EXISTS, "already exists");
        lpTokenStatus[_lpToken] = LpTokenStatus.ACTIVE;

        lpTokensAdded.push(_lpToken);
        lpTokenRewards[_lpToken] = rewards;

        emit AddLpToken(_lpToken, rewards);
    }

    function setLpTokenStatus(address _lpToken, LpTokenStatus _status) public onlyOwner {
        require(lpTokenStatus[_lpToken] != LpTokenStatus.NOT_EXISTS, "already exists");
        lpTokenStatus[_lpToken] = _status;
        emit SetLpTokenStatus(_lpToken, _status);
    }

    function vote(address[] memory _lpTokens, int256[] memory _deltas) public {
        uint256 len = _lpTokens.length;
        require(len == _deltas.length, "!len");
        uint256 votes = wmxLocker.getVotes(msg.sender);
        require(votes != 0, "no votes");

        uint256 userLockerVotes = userVotes(msg.sender);
        int256 lastDelta = 0;
        uint256 totalVotedByUser = 0;

        for (uint256 i = 0; i < len; i++) {
            require(i == 0 || _deltas[i] > lastDelta, "< lastDelta");
            lastDelta = _deltas[i];
            address rewards = lpTokenRewards[_lpTokens[i]];

            IBribeRewardsPool rewardsPool = IBribeRewardsPool(rewards);
            uint256 amount = _deltas[i] < 0 ? uint256(-_deltas[i]) : uint256(_deltas[i]);
            if (_deltas[i] < 0) {
                _rewardPoolWithdraw(rewardsPool, msg.sender, amount, msg.sender);
            } else if (_deltas[i] > 0) {
                _rewardPoolDeposit(rewardsPool, msg.sender, amount);
            }
        }

        require(userVotes[msg.sender] <= userLockerVotes, "votes overflow");

        if (executeOnVote && isVoteExecuteReady()) {
            _execute();
        }
    }

    function _rewardPoolWithdraw(IBribeRewardsPool _rewardsPool, address _user, uint256 _amount, address _claimFor) internal {
        userVotes[_user] -= _amount;
        rewardsPool.withdrawAndUnwrapFrom(_user, amount, _claimFor);
        stakingToken.burn(address(rewardsPool), amount);
    }

    function _rewardPoolDeposit(IBribeRewardsPool _rewardsPool, address _user, uint256 _amount, address _claimFor) internal {
        userVotes[_user] += amount;
        stakingToken.mint(address(this), amount);
        rewardsPool.stakeFor(msg.sender, amount);
    }

    function voteExecute() public {
        require(isVoteExecuteReady(), "!ready");

        uint256 totalLpVotes = totalVotes();
        uint256 veWomTotalSupply = veWom.totalSupply();
        uint256 ratio = veWomTotalSupply * 1 ether / totalLpVotes;

        uint256 len = lpTokensAdded.length;
        int256[] memory _deltas = new int256[](len);
        for (uint256 i = 0; i < len; i++) {
            address lpToken = lpTokensAdded[i];
            address rewardsPool = lpTokenRewards[lpToken];
            uint256 lpVotes = int256(IERC20(rewardsPool).totalSupply() * ratio);
            uint256 bribeVotes = bribeVoter.votes(voterProxy, lpToken);
            _deltas[i] = lpVotes - bribeVotes;
        }

        bytes memory rewardsData = booster.voteExecute(
            address(bribeVoter),
            0,
            abi.encodeWithSelector(IBribeVoter.vote.selector, lpTokensAdded, _deltas)
        );

        uint256[][] memory bribeRewards = abi.encode(rewardsData, uint256[][]);
        for (uint256 i = 0; i < len; i++) {
            address lpToken = lpTokensAdded[i];

            uint256[] memory rewards = bribeRewards[i];
            (, , , , , , address bribe) = bribeVoter.infos(lpToken);
            address[] memory rewardTokens = IMasterWombatRewarder(bribe).rewardTokens();

            address rewardsPool = lpTokenRewards[lpToken];

            uint256 tLen = rewardTokens.length;
            for (uint256 i = 0; i < tLen; i++) {
                uint256 amount = rewards[i];
                address token = rewardTokens[i];
                booster.voteExecute( //TODO: check return data
                    token,
                    0,
                    abi.encodeWithSelector(IERC20.transfer.selector, address(this), amount)
                );
                uint256 incentiveAmount = amount * voteIncentive / DENOMINATOR;
                IERC20(token).safeTransfer(msg.sender, incentiveAmount);
                IBribeRewardsPool(rewardsPool).queueNewRewards(token, amount - incentiveAmount);
            }
        }
        //TODO: callbacks
    }

    function updateBribeRewardsConfig(address[] calldata _rewards, bool _callOperatorOnGetReward) external onlyOwner{
        for(uint256 i = 0; i < _rewards.length; i++) {
            IBribeRewardsPool(_rewards[i]).updateBribesConfig(_callOperatorOnGetReward);
        }
    }

    function migrateStakingToken(address _newOperator) external onlyOwner {
        stakingToken.updateOperator(_newBooster);
        emit StakingTokenMigrate(_rewards[i], _newOperator);
    }

    function migrateRewards(address[] calldata _rewards, address _newOperator) external onlyOwner {
        uint256 len = _rewards.length;

        for (uint256 i = 0; i < len; i++) {
            IRewards(_rewards[i]).updateOperatorData(_newOperator, 0);
            emit RewardPoolMigrate(_rewards[i], _newOperator);
        }
    }

    function setRewardTokenPausedInPools(address[] memory _rewardPools, address _token, bool _paused) external onlyOwner {
        for (uint256 i = 0; i < _rewardPools.length; i++) {
            IRewards(_rewardPools[i]).setRewardTokenPaused(_token, _paused);
        }
    }

    function rewardClaimed(uint256, address, uint256, bool) external {
        if (isVoteExecuteReady()) {
            voteExecute();
        }
    }

    function onVotesChanged(address _user, address _incentiveRecipient) public {
        uint256 userLockerVotes = userVotes(_user);
        if (userLockerVotes >= userVotes[_user]) {
            return;
        }

        for (uint256 i = 0; i < len; i++) {
            IBribeRewardsPool rewardsPool = IBribeRewardsPool(lpTokenRewards[_lpTokens[i]]);
            _rewardPoolWithdraw(rewardsPool, _user, userVotes[_user], msg.sender);
        }
        //TODO: check user votes and slash rewards
    }

    function isVoteExecuteReady() public returns(bool) {
        return stakingToken.totalSupply() >= voteThreshold && isPeriodReady();
    }

    function isPeriodReady() public returns(bool) {
        return lastVoteAt + votePeriod < block.timestamp;
    }

    function totalVotes() public returns (uint256) {
        return stakingToken.totalSupply();
    }

    function userVotes(address _user) public returns (uint256 userLockerVotes) {
        userLockerVotes = wmxLocker.getVotes(msg.sender);
        if (address(nftLocker) != address(0)) {
            userLockerVotes = userLockerVotes * nftLocker.voteBoost(msg.sender) / 1 ether;
        }
    }
}
