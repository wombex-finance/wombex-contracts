// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "./Interfaces.sol";
import "./WombexLensUI.sol";

contract BoosterLensUI is Ownable {
    address public wmx;
    address public wom;
    address public wmxWom;
    WombexLensUI public wombexLensUI;
    IStaker public voterProxy;

    constructor(WombexLensUI _wombexLensUI, IStaker _voterProxy) {
        wombexLensUI = _wombexLensUI;
        voterProxy = _voterProxy;
        wom = _voterProxy.wom();
        wmx = IBooster(_voterProxy.operator()).cvx();
        wmxWom = IBaseRewardPool4626(IBooster(_voterProxy.operator()).crvLockRewards()).stakingToken();
    }

    function getTvl(IBooster _booster) public returns (uint256 tvlSum) {
        uint256 len = _booster.poolLength();

        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = _booster.poolInfo(i);
            address pool = IWomAsset(poolInfo.lptoken).pool();
            address underlyingToken = IWomAsset(poolInfo.lptoken).underlyingToken();
            tvlSum += ERC20(poolInfo.crvRewards).totalSupply() * wombexLensUI.getLpUsdOut(pool, underlyingToken, 1 ether) / 1 ether;
        }
        address voterProxy = _booster.voterProxy();
        tvlSum += wombexLensUI.estimateInBUSDEther(wom, ERC20(IStaker(voterProxy).veWom()).balanceOf(voterProxy), 18);
        tvlSum += wombexLensUI.estimateInBUSDEther(wmx, ERC20(wmx).balanceOf(_booster.cvxLocker()), 18);
    }

    function getTotalRevenue(IBooster _booster, address[] memory _oldCrvRewards, uint256 _revenueRatio) public returns (uint256 totalRevenueSum, uint256 totalWomSum) {
        uint256 len = _booster.poolLength();

        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = _booster.poolInfo(i);
            (uint256 revenueSum, uint256 womSum) = getPoolRewardsInUsd(poolInfo.crvRewards);
            totalRevenueSum += revenueSum;
            totalWomSum += womSum;
        }
        for (uint256 i = 0; i < _oldCrvRewards.length; i++) {
            (uint256 revenueSum, uint256 womSum) = getPoolRewardsInUsd(_oldCrvRewards[i]);
            totalRevenueSum += revenueSum;
            totalWomSum += womSum;
        }
        (uint256 revenueSum, uint256 womSum) = getPoolRewardsInUsd(_booster.crvLockRewards());
        totalRevenueSum += revenueSum;
        totalWomSum += womSum;

        totalRevenueSum += totalRevenueSum * _revenueRatio / 1 ether;
        // due to locker inaccessible rewards
        totalWomSum += totalWomSum * _revenueRatio / 1 ether;
        // due to locker inaccessible rewards
    }

    function getPoolRewardsInUsd(address _crvRewards) public returns (uint256 revenueSum, uint256 womSum) {
        address[] memory rewardTokensList = IBaseRewardPool4626(_crvRewards).rewardTokensList();

        uint256 len = rewardTokensList.length;
        for (uint256 j = 0; j < len; j++) {
            address t = rewardTokensList[j];
            IBaseRewardPool4626.RewardState memory tRewards = IBaseRewardPool4626(_crvRewards).tokenRewards(t);
            revenueSum += wombexLensUI.estimateInBUSDEther(t, tRewards.historicalRewards + tRewards.queuedRewards, getTokenDecimals(t));
            if (t == wom || t == wmxWom) {
                womSum += tRewards.historicalRewards + tRewards.queuedRewards;
            }
        }
    }

    function getProtocolStats(IBooster _booster, address[] memory _oldCrvRewards, uint256 _revenueRatio) public returns (uint256 tvl, uint256 totalRevenue, uint256 earnedWomSum, uint256 veWomShare) {
        tvl = getTvl(_booster);
        (totalRevenue, earnedWomSum) = getTotalRevenue(_booster, _oldCrvRewards, _revenueRatio);
        address voterProxy = _booster.voterProxy();
        ERC20 veWom = ERC20(IStaker(voterProxy).veWom());
        veWomShare = (veWom.balanceOf(voterProxy) * 1 ether) / veWom.totalSupply();
    }

    function getTokenDecimals(address _token) public view returns (uint8 decimals) {
        try ERC20(_token).decimals() returns (uint8 _decimals) {
            decimals = _decimals;
        } catch {
            decimals = uint8(18);
        }
    }

    struct BoostRatio {
        address lpToken;
        uint256 value;
    }

    function getRewardPoolStats(IMasterWombatV3 _masterWombat, WombexLensUI.RewardPoolInput[] memory apyInput) public returns (
        WombexLensUI.RewardPoolApyOutput[] memory apyList,
        BoostRatio[] memory boostRatioList
    ) {
        apyList = wombexLensUI.getRewardPoolApys(apyInput);
        boostRatioList = getBoostRatioList(_masterWombat, apyInput[0].booster);
    }

    function getBoostRatioList(IMasterWombatV3 _masterWombat, IBooster _booster) public view returns (BoostRatio[] memory boostRatioList) {
        uint256 poolLen = _booster.poolLength();
        boostRatioList = new BoostRatio[](poolLen);
        for (uint256 i = 0; i < poolLen; i++) {
            IBooster.PoolInfo memory pi = _booster.poolInfo(i);
            boostRatioList[i] = BoostRatio(pi.lptoken, getBoostRatio(_masterWombat, pi.lptoken));
        }
    }

    function getBoostRatio(IMasterWombatV3 _masterWombat, address lpToken) public view returns (uint256) {
        uint256 wmPid = voterProxy.lpTokenToPid(address(_masterWombat), lpToken);
        IMasterWombatV3.UserInfo memory ui = _masterWombat.userInfo(wmPid, address(voterProxy));
        if (ui.amount == 0) {
          return 0;
        }
        IMasterWombatV3.PoolInfoV3 memory pi = _masterWombat.poolInfoV3(wmPid);
        if (pi.accWomPerShare == 0) {
            return 0;
        }
        uint256 p1 = ui.amount * pi.accWomPerShare + ui.factor * pi.accWomPerFactorShare;
        uint256 p2 = ui.amount * pi.accWomPerShare;
        return p1 / (p2 / 1 ether);
    }
}
