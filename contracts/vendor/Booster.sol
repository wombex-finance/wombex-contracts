// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./interfaces/Interfaces.sol";
import "@openzeppelin/contracts-0.6/math/SafeMath.sol";
import "@openzeppelin/contracts-0.6/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.6/utils/Address.sol";
import "@openzeppelin/contracts-0.6/token/ERC20/SafeERC20.sol";

/**
 * @title   Booster
 * @author  ConvexFinance -> WombexFinance
 * @notice  Main deposit contract; keeps track of pool info & user deposits; distributes rewards.
 * @dev     They say all paths lead to Rome, and the Booster is no different. This is where it all goes down.
 *          It is responsible for tracking all the pools, it collects rewards from all pools and redirects it.
 */
contract Booster{
    using SafeERC20 for IERC20;
    using Address for address;
    using SafeMath for uint256;

    uint256 public constant MAX_PENALTY_SHARE = 3000;
    uint256 public constant DENOMINATOR = 10000;

    address public immutable crv;
    address public immutable cvx;
    address public immutable weth;
    address public immutable voterProxy;

    address public owner;
    address public feeManager;
    address public poolManager;
    address public rewardFactory;
    address public tokenFactory;
    address public earmarkDelegate;
    address public crvLockRewards;
    address public cvxLocker;
    address public reservoirMinter;

    mapping(address => bool) public voteDelegate;

    IExtraRewardsDistributor public extraRewardsDist;

    uint256 public penaltyShare = 0;
    bool public earmarkOnDeposit;

    uint256 public minMintRatio;
    uint256 public maxMintRatio;
    uint256 public mintRatio;
    bool public paused;

    mapping(uint256 => uint256) public customMintRatio;

    bool public isShutdown;

    struct PoolInfo {
        address lptoken;
        address token;
        address gauge;
        address crvRewards;
        bool shutdown;
    }

    //index(pid) -> pool
    PoolInfo[] public poolInfo;
    mapping(address => bool) public votingMap;

    mapping(address => address[]) public lpPendingRewardTokens;
    mapping(address => mapping(address => uint256)) public lpPendingRewards;

    event Deposited(address indexed user, uint256 indexed poolid, uint256 amount);
    event Withdrawn(address indexed user, uint256 indexed poolid, uint256 amount);

    event PoolAdded(address indexed lpToken, address gauge, address token, address crvRewards, uint256 pid);
    event PoolShutdown(uint256 indexed poolId);
    event RewardMigrate(address indexed crvRewards, address indexed newBooster, uint256 indexed poolId);

    event OwnerUpdated(address newOwner);
    event FeeManagerUpdated(address newFeeManager);
    event PoolManagerUpdated(address newPoolManager);
    event FactoriesUpdated(address rewardFactory, address tokenFactory);
    event ExtraRewardsDistributorUpdated(address newDist);
    event LpPendingRewardTokensUpdated(address indexed lpToken, address[] pendingRewardTokens);
    event PenaltyShareUpdated(uint256 newPenalty);
    event VoteDelegateUpdated(address voteDelegate, bool enabled);
    event EarmarkDelegateUpdated(address newEarmarkDelegate);
    event VotingMapUpdated(address voting, bool valid);
    event LockRewardContractsUpdated(address lockRewards, address cvxLocker);
    event MintParamsUpdated(uint256 mintRatio, address reservoirMinter);
    event SetPaused(bool paused);
    event CustomMintRatioUpdated(uint256 indexed pid, uint256 mintRatio);
    event SetEarmarkOnDeposit(bool earmarkOnDeposit);
    event FeeInfoUpdated(address feeDistro, address lockFees, address feeToken);
    event FeeInfoChanged(address feeToken, bool active);

    event EarmarkRewards(uint256 indexed pid, address indexed lpToken, address indexed rewardToken, uint256 amount);
    event EarmarkRewardsTransfer(uint256 indexed pid, address indexed lpToken, address indexed rewardToken, uint256 amount, address distro, bool queue);
    event RewardClaimed(uint256 indexed pid, address indexed user, uint256 amount, bool indexed lock, uint256 mintAmount, uint256 penalty);
    event MinterMint(address indexed recipient, uint256 amount);

    /**
     * @dev Constructor doing what constructors do. It is noteworthy that
     *      a lot of basic config is set to 0 - expecting subsequent calls to setFeeInfo etc.
     * @param _voterProxy             VoterProxy (locks the crv and adds to all gauges)
     * @param _reservoirMinter        Reservoir
     * @param _cvx                    CVX/WMX token
     * @param _crv                    CRV/WOM
     * @param _weth                   WETH
     * @param _minMintRatio           Min mint ratio
     * @param _maxMintRatio           Max mint ratio
     */
    constructor(
        address _voterProxy,
        address _reservoirMinter,
        address _cvx,
        address _crv,
        address _weth,
        uint256 _minMintRatio,
        uint256 _maxMintRatio
    ) public {
        voterProxy = _voterProxy;
        reservoirMinter = _reservoirMinter;
        cvx = _cvx;
        crv = _crv;
        weth = _weth;
        isShutdown = false;

        minMintRatio = _minMintRatio;
        maxMintRatio = _maxMintRatio;

        owner = msg.sender;
        feeManager = msg.sender;
        poolManager = msg.sender;

        emit OwnerUpdated(msg.sender);
        emit FeeManagerUpdated(msg.sender);
        emit PoolManagerUpdated(msg.sender);
    }


    /// SETTER SECTION ///

    /**
     * @notice Owner is responsible for setting initial config, updating vote delegate and shutting system
     */
    function setOwner(address _owner) external {
        require(msg.sender == owner, "!auth");
        owner = _owner;

        emit OwnerUpdated(_owner);
    }

    /**
     * @notice Fee Manager can update the fees (lockIncentive, stakeIncentive, earmarkIncentive, platformFee)
     */
    function setFeeManager(address _feeM) external {
        require(msg.sender == owner, "!auth");
        feeManager = _feeM;

        emit FeeManagerUpdated(_feeM);
    }

    /**
     * @notice Pool manager is responsible for adding new pools
     */
    function setPoolManager(address _poolM) external {
        require(msg.sender == poolManager, "!auth");
        poolManager = _poolM;

        emit PoolManagerUpdated(_poolM);
    }

    /**
     * @notice Factories are used when deploying new pools.
     */
    function setFactories(address _rfactory, address _tfactory) external {
        require(msg.sender == owner, "!auth");
        require(rewardFactory == address(0), "!zero");

        //reward factory only allow this to be called once even if owner
        //removes ability to inject malicious staking contracts
        //token factory can also be immutable
        rewardFactory = _rfactory;
        tokenFactory = _tfactory;

        emit FactoriesUpdated(_rfactory, _tfactory);
    }

    /**
     * @notice Extra rewards distributor handles cvx/wmx penalty
     */
    function setExtraRewardsDistributor(address _dist) external {
        require(msg.sender==owner, "!auth");
        extraRewardsDist = IExtraRewardsDistributor(_dist);

        IERC20(cvx).safeApprove(_dist, 0);
        IERC20(cvx).safeApprove(_dist, type(uint256).max);

        emit ExtraRewardsDistributorUpdated(_dist);
    }

    /**
     * @notice Extra rewards distributor handles cvx/wmx penalty
     */
    function setRewardClaimedPenalty(uint256 _penaltyShare) external {
        require(msg.sender==owner, "!auth");
        require(_penaltyShare <= MAX_PENALTY_SHARE, ">max");
        penaltyShare = _penaltyShare;

        emit PenaltyShareUpdated(_penaltyShare);
    }

    function setRewardTokenPausedInPools(address[] memory _rewardPools, address _token, bool _paused) external {
        require(msg.sender==owner, "!auth");

        for (uint256 i = 0; i < _rewardPools.length; i++) {
            IRewards(_rewardPools[i]).setRewardTokenPaused(_token, _paused);
        }
    }

    /**
     * @notice Vote Delegate has the rights to cast votes on the VoterProxy via the Booster
     */
    function setVoteDelegate(address _voteDelegate, bool _enabled) external {
        require(msg.sender==owner, "!auth");
        voteDelegate[_voteDelegate] = _enabled;

        emit VoteDelegateUpdated(_voteDelegate, _enabled);
    }

    /**
     * @notice Vote Delegate has the rights to cast votes on the VoterProxy via the Booster
     */
    function setVotingValid(address _voting, bool _valid) external {
        require(msg.sender == owner || voteDelegate[msg.sender], "!auth");
        votingMap[_voting] = _valid;

        emit VotingMapUpdated(_voting, _valid);
    }

    /**
     * @notice Earmark Delegate has the rights to cast claim and distribute VoterProxy rewards
     */
    function setEarmarkDelegate(address _earmarkDelegate) external {
        require(msg.sender==owner, "!auth");
        earmarkDelegate = _earmarkDelegate;

        emit EarmarkDelegateUpdated(_earmarkDelegate);
    }

    /**
     * @notice Set tokens to cache pending rewards
     */
    function setLpPendingRewardTokens(address _lpToken, address[] memory _addresses) external {
        require(msg.sender==owner, "!auth");
        lpPendingRewardTokens[_lpToken] = _addresses;

        emit LpPendingRewardTokensUpdated(_lpToken, _addresses);
    }

    /**
     * @notice Set tokens to cache pending rewards
     */
    function updateLpPendingRewardTokensByGauge(uint256 _pid) external {
        require(msg.sender==owner, "!auth");
        PoolInfo storage p = poolInfo[_pid];
        lpPendingRewardTokens[p.lptoken] = IStaker(voterProxy).getGaugeRewardTokens(p.lptoken, p.gauge);

        emit LpPendingRewardTokensUpdated(p.lptoken, lpPendingRewardTokens[p.lptoken]);
    }

    /**
     * @notice Only called once, to set the address of cvxCrv/wmxWOM (lockRewards)
     */
    function setLockRewardContracts(address _crvLockRewards, address _cvxLocker) external {
        require(msg.sender == owner, "!auth");

        //reward contracts are immutable or else the owner
        //has a means to redeploy and mint cvx/wmx via rewardClaimed()
        if (crvLockRewards == address(0)){
            crvLockRewards = _crvLockRewards;
            cvxLocker = _cvxLocker;
            IERC20(cvx).approve(cvxLocker, type(uint256).max);
            emit LockRewardContractsUpdated(_crvLockRewards, _cvxLocker);
        }
    }

    /**
     * @notice Change mint ratio in boundaries
     */
    function setMintParams(uint256 _mintRatio, address _reservoirMinter) external {
        require(msg.sender == owner, "!auth");
        if (_mintRatio != 0) {
            require(_mintRatio >= minMintRatio && _mintRatio <= maxMintRatio, "!boundaries");
        }

        mintRatio = _mintRatio;
        reservoirMinter = _reservoirMinter;
        emit MintParamsUpdated(_mintRatio, _reservoirMinter);
    }

    /**
     * @notice Change mint ratio in boundaries
     */
    function setPaused(bool _paused) external {
        require(msg.sender == owner, "!auth");
        paused = _paused;
        emit SetPaused(_paused);
    }

    /**
     * @notice Change mint ratio for pool
     */
    function setCustomMintRatioMultiple(uint256[] memory _pids, uint256[] memory _mintRatios) external {
        require(msg.sender == owner, "!auth");

        uint256 len = _pids.length;
        require(len == _mintRatios.length, "!len");

        for(uint256 i = 0; i < len; i++) {
            if (_mintRatios[i] != 0) {
                require(_mintRatios[i] >= minMintRatio && _mintRatios[i] <= maxMintRatio, "!boundaries");
            }

            customMintRatio[_pids[i]] = _mintRatios[i];
            emit CustomMintRatioUpdated(_pids[i], _mintRatios[i]);
        }
    }

    /**
     * @notice Owner can set earmarkOnDeposit
     * @param _earmarkOnDeposit   Call earmark on deposit or not
     */
    function setEarmarkOnDeposit(bool _earmarkOnDeposit) external{
        require(msg.sender == owner, "!auth");
        earmarkOnDeposit = _earmarkOnDeposit;
        emit SetEarmarkOnDeposit(_earmarkOnDeposit);
    }

    /// END SETTER SECTION ///

    /**
     * @notice Called by the PoolManager (i.e. PoolManagerProxy) to add a new pool - creates all the required
     *         contracts (DepositToken, RewardPool) and then adds to the list!
     */
    function addPool(address _lptoken, address _gauge) external returns (uint256) {
        //the next pool's pid
        uint256 pid = poolInfo.length;

        //create a tokenized deposit
        address token = ITokenFactory(tokenFactory).CreateDepositToken(_lptoken);
        //create a reward contract for crv rewards
        address newRewardPool = IRewardFactory(rewardFactory).CreateCrvRewards(pid,token,_lptoken);

        return addCreatedPool(_lptoken, _gauge, token, newRewardPool);
    }


    /**
     * @notice Called by the PoolManager (i.e. PoolManagerProxy) to add a new pool - creates all the required
     *         contracts (DepositToken, RewardPool) and then adds to the list!
     */
    function addCreatedPool(address _lptoken, address _gauge, address _token, address _crvRewards) public returns (uint256){
        require(msg.sender == poolManager && !isShutdown, "!add");
        require(_gauge != address(0) && _lptoken != address(0),"!param");

        //the next pool's pid
        uint256 pid = poolInfo.length;

        if (IRewards(_crvRewards).pid() != pid) {
            IRewards(_crvRewards).updateOperatorData(address(this), pid);
        }

        IERC20(_token).safeApprove(_crvRewards, 0);
        IERC20(_token).safeApprove(_crvRewards, type(uint256).max);

        //add the new pool
        poolInfo.push(
            PoolInfo({
                lptoken: _lptoken,
                token: _token,
                gauge: _gauge,
                crvRewards: _crvRewards,
                shutdown: false
            })
        );

        emit PoolAdded(_lptoken, _gauge, _token, _crvRewards, pid);
        return poolInfo.length.sub(1);
    }

    /**
     * @notice Shuts down the pool by withdrawing everything from the gauge to here (can later be
     *         claimed from depositors by using the withdraw fn) and marking it as shut down
     */
    function shutdownPool(uint256 _pid) external returns(bool) {
        require(msg.sender == poolManager, "!auth");
        PoolInfo storage pool = poolInfo[_pid];

        //withdraw from gauge
        IStaker(voterProxy).withdrawAllLp(pool.lptoken,pool.gauge);

        pool.shutdown = true;

        emit PoolShutdown(_pid);
        return true;
    }

    /**
     * @notice Shuts down the pool and sets shutdown flag even if withdrawAllLp failed.
     */
    function forceShutdownPool(uint256 _pid) external returns(bool){
        require(msg.sender==poolManager, "!auth");
        PoolInfo storage pool = poolInfo[_pid];

        //withdraw from gauge
        uint128 amount = getLpBalance(pool.gauge, pool.lptoken);
        try IStaker(voterProxy).withdrawLp(pool.lptoken, pool.gauge, amount) {} catch {}

        pool.shutdown = true;

        emit PoolShutdown(_pid);
        return true;
    }

    /**
     * @notice Shuts down the WHOLE SYSTEM by withdrawing all the LP tokens to here and then allowing
     *         for subsequent withdrawal by any depositors.
     */
    function shutdownSystem() external{
        require(msg.sender == owner, "!auth");
        isShutdown = true;

        for(uint i=0; i < poolInfo.length; i++){
            PoolInfo storage pool = poolInfo[i];
            if (pool.shutdown) continue;

            //withdraw from gauge
            uint128 amount = getLpBalance(pool.gauge, pool.lptoken);
            try IStaker(voterProxy).withdrawLp(pool.lptoken, pool.gauge, amount) {
                pool.shutdown = true;
            }catch{}
        }
    }

    function migrateRewards(address[] calldata _rewards, uint256[] calldata _pids, address _newBooster) external {
        require(msg.sender == owner, "!auth");
        require(isShutdown, "!shutdown");

        uint256 len = _rewards.length;
        require(len == _pids.length, "!length");

        for (uint256 i = 0; i < len; i++) {
            if (_rewards[i] == address(0)) {
                continue;
            }
            IRewards(_rewards[i]).updateOperatorData(_newBooster, _pids[i]);
            if (_rewards[i] != crvLockRewards) {
                address stakingToken = IRewards(_rewards[i]).stakingToken();
                ITokenMinter(stakingToken).updateOperator(_newBooster);
            }
            emit RewardMigrate(_rewards[i], _newBooster, _pids[i]);
        }
    }

    /**
     * @notice  Deposits an "_amount" to a given gauge (specified by _pid), mints a `DepositToken`
     *          and subsequently stakes that on BaseRewardPool
     */
    function deposit(uint256 _pid, uint256 _amount, bool _stake) public returns(bool){
        return depositFor(_pid, _amount, _stake, msg.sender);
    }

    /**
     * @notice  Deposits an "_amount" to a given gauge (specified by _pid), mints a `DepositToken`
     *          and subsequently stakes that on BaseRewardPool
     */
    function depositFor(uint256 _pid, uint256 _amount, bool _stake, address _receiver) public returns(bool){
        require(!isShutdown,"shutdown");
        require(!paused, "paused");
        PoolInfo storage pool = poolInfo[_pid];
        require(pool.shutdown == false, "closed");

        //send to proxy to stake
        address lptoken = pool.lptoken;
        IERC20(lptoken).safeTransferFrom(msg.sender, voterProxy, _amount);

        //stake
        address gauge = pool.gauge;
        require(gauge != address(0),"!gauge");

        uint256[] memory rewardBalancesBefore = getPendingRewards(lptoken);
        IStaker(voterProxy).deposit(lptoken, gauge);
        _writePendingRewards(lptoken, rewardBalancesBefore);

        if (earmarkOnDeposit) {
            IBoosterEarmark(earmarkDelegate).earmarkRewards(_pid);
        }

        address token = pool.token;
        if(_stake){
            //mint here and send to rewards on user behalf
            ITokenMinter(token).mint(address(this), _amount);
            IRewards(pool.crvRewards).stakeFor(_receiver, _amount);
        }else{
            //add user balance directly
            ITokenMinter(token).mint(_receiver, _amount);
        }

        emit Deposited(_receiver, _pid, _amount);
        return true;
    }

    /**
     * @notice  Withdraws LP tokens from a given PID (& user).
     *          1. Burn the cvxLP/wmxLP balance from "_from" (implicit balance check)
     *          2. If pool !shutdown.. withdraw from gauge
     *          3. Transfer out the LP tokens
     */
    function _withdraw(uint256 _pid, uint256 _amount, address _from, address _to) internal {
        require(!paused, "paused");
        PoolInfo storage pool = poolInfo[_pid];
        address lptoken = pool.lptoken;
        address gauge = pool.gauge;

        //remove lp balance
        address token = pool.token;
        ITokenMinter(token).burn(_from,_amount);

        //pull from gauge if not shutdown
        // if shutdown tokens will be in this contract
        if (!pool.shutdown) {
            uint256[] memory rewardBalancesBefore = getPendingRewards(lptoken);
            IStaker(voterProxy).withdrawLp(lptoken, gauge, _amount);
            _writePendingRewards(lptoken, rewardBalancesBefore);

            if (earmarkOnDeposit) {
                IBoosterEarmark(earmarkDelegate).earmarkRewards(_pid);
            }
        }

        //return lp tokens
        IERC20(lptoken).safeTransfer(_to, _amount);

        emit Withdrawn(_to, _pid, _amount);
    }

    /**
     * @notice  Withdraw a given amount from a pool (must already been unstaked from the Reward Pool -
     *          BaseRewardPool uses withdrawAndUnwrap to get around this)
     */
    function withdraw(uint256 _pid, uint256 _amount) public returns(bool){
        _withdraw(_pid,_amount,msg.sender,msg.sender);
        return true;
    }

    /**
     * @notice Allows the actual BaseRewardPool to withdraw and send directly to the user
     */
    function withdrawTo(uint256 _pid, uint256 _amount, address _to) external returns(bool){
        address rewardContract = poolInfo[_pid].crvRewards;
        require(msg.sender == rewardContract,"!auth");

        _withdraw(_pid,_amount,msg.sender,_to);
        return true;
    }

    function getPendingRewardTokens(address _lptoken) public view returns (address[] memory tokens) {
        if (lpPendingRewardTokens[_lptoken].length > 0) {
            return lpPendingRewardTokens[_lptoken];
        } else {
            tokens = new address[](1);
            tokens[0] = crv;
        }
    }

    function getPendingRewards(address _lptoken) public view returns (uint256[] memory result) {
        address[] memory tokens = getPendingRewardTokens(_lptoken);
        uint256 len = tokens.length;
        result = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 balance = IERC20(tokens[i]).balanceOf(voterProxy);
            if (tokens[i] == weth) {
                balance = balance.add(voterProxy.balance);
            }
            result[i] = balance;
        }
    }

    function _writePendingRewards(address _lptoken, uint256[] memory _rewardsBefore) internal {
        address[] memory tokens = getPendingRewardTokens(_lptoken);
        uint256 len = _rewardsBefore.length;
        for (uint256 i = 0; i < len; i++) {
            address token = tokens[i];
            uint256 balance = IERC20(token).balanceOf(voterProxy);
            if (token == weth) {
                balance = balance.add(voterProxy.balance);
            }
            lpPendingRewards[_lptoken][token] = lpPendingRewards[_lptoken][token].add(balance.sub(_rewardsBefore[i]));
        }
    }

    /**
     * @notice set valid vote hash on VoterProxy
     */
    function setVote(bytes32 _hash, bool valid) external returns(bool){
        require(voteDelegate[msg.sender], "!auth");

        IStaker(voterProxy).setVote(_hash, valid);
        return true;
    }

    /**
     * @notice Delegate address votes on gauge weight via VoterProxy
     */
    function voteExecute(address _voting, uint256 _value, bytes calldata _data) external payable returns(bytes memory result) {
        require(voteDelegate[msg.sender], "!auth");
        require(votingMap[_voting], "!voting");

        (, result) = IStaker(voterProxy).execute{value:_value}(_voting, _value, _data);
        return result;
    }

    function voterProxyClaimRewards(uint256 _pid, address[] memory _pendingTokens) external returns (uint256[] memory pendingRewards) {
        require(earmarkDelegate == msg.sender, "!auth");

        PoolInfo storage pool = poolInfo[_pid];
        address lptoken = pool.lptoken;

        IStaker(voterProxy).claimCrv(lptoken, pool.gauge);

        uint256 tLen = _pendingTokens.length;
        pendingRewards = new uint256[](tLen);

        for (uint256 i = 0; i < tLen; i++) {
            pendingRewards[i] = lpPendingRewards[lptoken][_pendingTokens[i]];
            if (lpPendingRewards[lptoken][_pendingTokens[i]] > 0) {
                lpPendingRewards[lptoken][_pendingTokens[i]] = 0;
            }
        }
    }

    function distributeRewards(
        uint256 _pid,
        address _lpToken,
        address _rewardToken,
        address[] memory _transferTo,
        uint256[] memory _transferAmount,
        bool[] memory _callQueue
    ) external {
        require(!paused, "paused");
        require(earmarkDelegate == msg.sender, "!auth");

        uint256 tLen = _transferTo.length;
        require(tLen == _transferAmount.length && tLen == _callQueue.length, "!len");

        uint256 sum = 0;
        for (uint256 i = 0; i < tLen; i++) {
            if (_transferAmount[i] == 0) {
                continue;
            }
            sum = sum.add(_transferAmount[i]);
            if (_callQueue[i]) {
                IRewards(_transferTo[i]).queueNewRewards(_rewardToken, _transferAmount[i]);
            } else {
                IERC20(_rewardToken).safeTransfer(_transferTo[i], _transferAmount[i]);
            }
            emit EarmarkRewardsTransfer(_pid, _lpToken, _rewardToken, _transferAmount[i], _transferTo[i], _callQueue[i]);
        }
        emit EarmarkRewards(_pid, _lpToken, _rewardToken, sum);
    }

    function approveDistribution(address _distro, address[] memory _distributionTokens, uint256 _amount) external {
        require(earmarkDelegate == msg.sender, "!auth");

        uint256 distTokensLen = _distributionTokens.length;
        for (uint256 i = 0; i < distTokensLen; i++) {
            IERC20(_distributionTokens[i]).safeApprove(_distro, 0);
            if (_amount > 0) {
                IERC20(_distributionTokens[i]).safeApprove(_distro, _amount);
            }
        }
    }

    function approvePoolsCrvRewardsDistribution(address _token) external {
        require(earmarkDelegate == msg.sender, "!auth");

        uint256 poolLen = poolInfo.length;
        for (uint256 i = 0; i < poolLen; i++) {
            IERC20(_token).safeApprove(poolInfo[i].crvRewards, 0);
            IERC20(_token).safeApprove(poolInfo[i].crvRewards, type(uint256).max);
        }
    }

    /**
     * @notice Callback from reward contract when crv/wom is received.
     * @dev    Goes off and mints a relative amount of CVX/WMX based on the distribution schedule.
     */
    function rewardClaimed(uint256 _pid, address _address, uint256 _amount, bool _lock) external returns(bool){
        require(!paused, "paused");
        address rewardContract = poolInfo[_pid].crvRewards;
        require(msg.sender == rewardContract || msg.sender == crvLockRewards, "!auth");

        uint256 mintAmount = _amount;
        uint256 poolMintRatio = customMintRatio[_pid];
        if (poolMintRatio == 0) {
            poolMintRatio = mintRatio;
        }
        if (poolMintRatio > 0) {
            mintAmount = mintAmount.mul(poolMintRatio).div(DENOMINATOR);
        }

        ITokenMinter tokenMinter = reservoirMinter == address(0) ? ITokenMinter(cvx) : ITokenMinter(reservoirMinter);
        uint256 penalty;
        if (_lock) {
            uint256 balanceBefore = IERC20(cvx).balanceOf(address(this));
            tokenMinter.mint(address(this), mintAmount);
            ICvxLocker(cvxLocker).lock(_address, IERC20(cvx).balanceOf(address(this)).sub(balanceBefore));
        } else {
            penalty = mintAmount.mul(penaltyShare).div(DENOMINATOR);
            mintAmount = mintAmount.sub(penalty);
            //mint reward to user, except the penalty
            tokenMinter.mint(_address, mintAmount);
            if (penalty > 0) {
                uint256 balanceBefore = IERC20(cvx).balanceOf(address(this));
                tokenMinter.mint(address(this), penalty);
                extraRewardsDist.addReward(cvx, IERC20(cvx).balanceOf(address(this)).sub(balanceBefore));
            }
        }
        emit RewardClaimed(_pid, _address, _amount, _lock, mintAmount, penalty);
        return true;
    }

    /**
     * @notice Allows the owner to mint new `cvx` tokens and allocate them to a specified address.
     * @param _address The address to allocate the newly minted tokens to.
     * @param _amount The amount of `cvx` tokens to be minted.
     * @return A boolean indicating whether or not the operation was successful.
     */
    function minterMint(address _address, uint256 _amount) external returns(bool){
        require(msg.sender == owner, "!auth");
        ITokenMinter(cvx).mint(_address, _amount);
        emit MinterMint(_address, _amount);
        return true;
    }


    function getLpBalance(address _gauge, address _lptoken) public returns (uint128 amount) {
        uint256 mwPid = IStaker(voterProxy).lpTokenToPid(_gauge, _lptoken);
        (amount, , ,) = IMasterWombat(_gauge).userInfo(mwPid, voterProxy);
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }
}
