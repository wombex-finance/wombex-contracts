// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

contract BoosterEarmark is Ownable {
    uint256 public constant MAX_DISTRIBUTION = 2500;
    uint256 public constant DENOMINATOR = 10000;

    IBooster public booster;
    address public voterProxy;
    address public weth;

    uint256 public earmarkIncentive;

    mapping(address => TokenDistro[]) public distributionByTokens;
    mapping(uint256 => mapping(address => TokenDistro[])) public customDistributionByTokens;

    struct TokenDistro {
        address distro;
        uint256 share;
        bool callQueue;
    }
    address[] distributionTokens;

    struct EarmarkState {
        IERC20 token;
        uint256 balance;
        uint256 dLen;
        uint256 earmarkIncentiveAmount;
        uint256 sentSum;
        uint256 totalDLen;
    }

    event TokenDistributionUpdate(address indexed token, address indexed distro, uint256 share, bool callQueue);
    event DistributionUpdate(address indexed token, uint256 distrosLength, uint256 sharesLength, uint256 callQueueLength, uint256 totalShares);
    event CustomDistributionUpdate(uint256 indexed pid, address indexed token, uint256 distrosLength, uint256 sharesLength, uint256 callQueueLength, uint256 totalShares);
    event ClearDistributionApproval(address indexed distro, address[] tokens);

    event SetPoolManager(address poolManager);

    event SetEarmarkConfig(uint256 earmarkIncentive);
    event EarmarkRewards(uint256 indexed pid, address indexed lpToken, address indexed rewardToken, uint256 amount);
    event EarmarkRewardsTransfer(uint256 indexed pid, address indexed lpToken, address indexed rewardToken, uint256 amount, address distro, bool queue);

    event ReleaseToken(address indexed token, uint256 amount, address indexed recipient);

    constructor(address _booster, address _weth) public {
        booster = IBooster(_booster);
        voterProxy = IBooster(_booster).voterProxy();
        weth = _weth;
    }

    /**
     * @notice Fee manager can set all the relevant fees
     * @param _earmarkIncentive   % for whoever calls the claim where 1% == 100
     */
    function setEarmarkConfig(uint256 _earmarkIncentive) external onlyOwner {
        require(_earmarkIncentive <= 100, ">max");
        earmarkIncentive = _earmarkIncentive;
        emit SetEarmarkConfig(_earmarkIncentive);
    }

    /**
     * @notice Call setPoolManager on booster
     */
    function setBoosterPoolManager(address _poolManager) external onlyOwner {
        booster.setPoolManager(_poolManager);
        emit SetPoolManager(_poolManager);
    }

    /**
     * @notice Call addPool on booster
     */
    function addPool(address _lptoken, address _gauge) external onlyOwner returns (uint256) {
        uint256 pid = booster.addPool(_lptoken, _gauge);
        approvePoolDistributionTokens(pid);
        return pid;
    }

    /**
     * @notice Call addCreatedPool on booster
     */
    function addCreatedPool(address _lptoken, address _gauge, address _token, address _crvRewards) external onlyOwner returns (uint256) {
        uint256 pid = booster.addCreatedPool(_lptoken, _gauge, _token, _crvRewards);
        approvePoolDistributionTokens(pid);
        return pid;
    }

    function shutdownPool(uint256 _pid) external onlyOwner returns (bool) {
        return booster.shutdownPool(_pid);
    }

    function forceShutdownPool(uint256 _pid) external onlyOwner returns (bool) {
        return booster.forceShutdownPool(_pid);
    }

    function gaugeMigrate(address _newGauge, uint256[] calldata migratePids) external onlyOwner {
        return booster.gaugeMigrate(_newGauge, migratePids);
    }

    /**
     * @notice Call approveDistributionTokens on booster
     */
    function approvePoolDistributionTokens(uint256 _pid) public onlyOwner {
        IBooster.PoolInfo memory p = booster.poolInfo(_pid);
        booster.approveDistribution(p.crvRewards, distributionTokens, type(uint256).max);
    }

    /**
     * @notice Allows turning off or on for fee distro
     */
    function clearDistroApprovals(address distro) external onlyOwner {
        booster.approveDistribution(distro, distributionTokens, 0);

        emit ClearDistributionApproval(distro, distributionTokens);
    }

    /**
     * @notice Allows turning off or on for fee distro
     */
    function updateDistributionByTokens(
        address _token,
        address[] memory _distros,
        uint256[] memory _shares,
        bool[] memory _callQueue
    ) external onlyOwner {
        require(_distros.length > 0, "zero");

        if (distributionByTokens[_token].length == 0) {
            distributionTokens.push(_token);
        }

        uint256 totalShares = _updateDistributionByTokens(_token, distributionByTokens[_token], _distros, _shares, _callQueue);

        booster.approvePoolsCrvRewardsDistribution(_token);

        emit DistributionUpdate(_token, _distros.length, _shares.length, _callQueue.length, totalShares);
    }

    /**
     * @notice Allows turning off or on for fee distro
     */
    function updateCustomDistributionByTokens(
        uint256 _pid,
        address _token,
        address[] memory _distros,
        uint256[] memory _shares,
        bool[] memory _callQueue
    ) external onlyOwner {
        uint256 totalShares = _updateDistributionByTokens(_token, customDistributionByTokens[_pid][_token], _distros, _shares, _callQueue);

        IBooster.PoolInfo memory p = booster.poolInfo(_pid);

        address[] memory tokens = new address[](1);
        tokens[0] = _token;

        booster.approveDistribution(p.crvRewards, tokens, type(uint256).max);

        emit CustomDistributionUpdate(_pid, _token, _distros.length, _shares.length, _callQueue.length, totalShares);
    }

    function _updateDistributionByTokens(
        address _token,
        TokenDistro[] storage _tds,
        address[] memory _distros,
        uint256[] memory _shares,
        bool[] memory _callQueue
    ) internal returns(uint256) {
        uint256 curLen = _tds.length;
        for (uint256 i = 0; i < curLen; i++) {
            address distro = _tds[_tds.length - 1].distro;
            _tds.pop();
        }

        uint256 totalShares = 0;

        uint256 len = _distros.length;
        require(len == _shares.length && len == _callQueue.length, "!length");

        for (uint256 i = 0; i < len; i++) {
            require(_distros[i] != address(0), "!distro");
            totalShares = totalShares + _shares[i];
            _tds.push(TokenDistro(_distros[i], _shares[i], _callQueue[i]));
            emit TokenDistributionUpdate(_token, _distros[i], _shares[i], _callQueue[i]);

            if (_callQueue[i]) {
                address[] memory tokens = new address[](1);
                tokens[0] = _token;
                booster.approveDistribution(_distros[i], tokens, type(uint256).max);
            }
        }
        require(totalShares <= MAX_DISTRIBUTION, ">max");
        return totalShares;
    }

    function _rewardTokenBalances(uint256 _pid, address[] memory _tokens) internal returns (uint256[] memory balances) {
        uint256 tLen = _tokens.length;

        uint256[] memory balancesBefore = new uint256[](tLen);
        for (uint256 i = 0; i < tLen; i++) {
            balancesBefore[i] = IERC20(_tokens[i]).balanceOf(address(booster)) + IERC20(_tokens[i]).balanceOf(voterProxy);
            if (_tokens[i] == weth) {
                balancesBefore[i] = balancesBefore[i] + voterProxy.balance;
            }
        }

        uint256[] memory pendingRewards = booster.voterProxyClaimRewards(_pid, _tokens);

        balances = new uint256[](tLen);
        for (uint256 i = 0; i < tLen; i++) {
            balances[i] = IERC20(_tokens[i]).balanceOf(address(booster)) - balancesBefore[i] + pendingRewards[i];
        }
    }

    function earmarkRewards(uint256 _pid) external {
        IBooster.PoolInfo memory p = booster.poolInfo(_pid);
        require(!p.shutdown, "closed");

        //claim crv/wom and bonus tokens
        address[] memory tokens = IStaker(voterProxy).getGaugeRewardTokens(p.lptoken, p.gauge);
        uint256[] memory balances = _rewardTokenBalances(_pid, tokens);

        for (uint256 i = 0; i < tokens.length; i++) {
            EarmarkState memory s;
            s.token = IERC20(tokens[i]);
            s.balance = balances[i];

            emit EarmarkRewards(_pid, p.lptoken, address(s.token), s.balance);

            if (s.balance == 0) {
                continue;
            }
            s.dLen = _getDistributionByTokens(_pid, address(s.token)).length;
            require(s.dLen > 0, "!dLen");

            s.earmarkIncentiveAmount = s.balance * earmarkIncentive / DENOMINATOR;
            s.sentSum = s.earmarkIncentiveAmount;

            s.totalDLen = s.dLen + 1 + (s.earmarkIncentiveAmount > 0 ? 1 : 0);
            address[] memory _transferTo = new address[](s.totalDLen);
            uint256[] memory _transferAmount = new uint256[](s.totalDLen);
            bool[] memory _callQueue = new bool[](s.totalDLen);

            for (uint256 j = 0; j < s.dLen; j++) {
                TokenDistro memory tDistro = _getDistributionByTokens(_pid, address(s.token))[j];
                if (tDistro.share == 0) {
                    continue;
                }
                uint256 amount = s.balance * tDistro.share / DENOMINATOR;
                s.sentSum += amount;

                _transferAmount[j] = amount;
                _transferTo[j] = tDistro.distro;
                _callQueue[j] = tDistro.callQueue;

                emit EarmarkRewardsTransfer(_pid, p.lptoken, address(s.token), amount, tDistro.distro, tDistro.callQueue);
            }
            if (s.earmarkIncentiveAmount > 0) {
                _transferAmount[s.totalDLen - 2] = s.earmarkIncentiveAmount;
                _transferTo[s.totalDLen - 2] = msg.sender;
                _callQueue[s.totalDLen - 2] = false;

                emit EarmarkRewardsTransfer(_pid, p.lptoken, address(s.token), s.earmarkIncentiveAmount, msg.sender, false);
            }

            _transferAmount[s.totalDLen - 1] = s.balance - s.sentSum;
            _transferTo[s.totalDLen - 1] = p.crvRewards;
            _callQueue[s.totalDLen - 1] = true;

            booster.distributeRewards(_pid, p.lptoken, tokens[i], _transferTo, _transferAmount, _callQueue);

            emit EarmarkRewardsTransfer(_pid, p.lptoken, address(s.token), _transferAmount[s.totalDLen - 1], p.crvRewards, true);
        }
    }

    function _getDistributionByTokens(uint256 _pid, address _rewardToken) internal view returns(TokenDistro[] memory) {
        if (customDistributionByTokens[_pid][_rewardToken].length > 0) {
            return customDistributionByTokens[_pid][_rewardToken];
        }
        return distributionByTokens[_rewardToken];
    }

    function releaseToken(address _token, address _recipient) external onlyOwner {
        uint256 totalPendingRewards;
        uint256 poolLen = booster.poolLength();
        for (uint256 i = 0; i < poolLen; i++) {
            IBooster.PoolInfo memory p = booster.poolInfo(i);
            if (p.shutdown) {
                if (_token == p.lptoken) {
                    totalPendingRewards = totalPendingRewards + IERC20(p.token).totalSupply();
                }
            } else {
                totalPendingRewards = totalPendingRewards + booster.lpPendingRewards(p.lptoken, _token);
            }
        }

        uint256 amountToWithdraw = IERC20(_token).balanceOf(address(booster)) - totalPendingRewards;

        address[] memory transferTo = new address[](1);
        transferTo[0] = _token;

        uint256[] memory transferAmount = new uint256[](1);
        transferAmount[0] = amountToWithdraw;

        bool[] memory callQueue = new bool[](1);
        callQueue[0] = false;

        booster.distributeRewards(type(uint256).max, address(0), _token, transferTo, transferAmount, callQueue);
        emit ReleaseToken(_token, amountToWithdraw, _recipient);
    }

    function distributionByTokenLength(address _token) external view returns (uint256) {
        return distributionByTokens[_token].length;
    }

    function customDistributionByTokenLength(uint256 _pid, address _token) external view returns (uint256) {
        return customDistributionByTokens[_pid][_token].length;
    }

    function distributionTokenList() external view returns (address[] memory) {
        return distributionTokens;
    }
}
