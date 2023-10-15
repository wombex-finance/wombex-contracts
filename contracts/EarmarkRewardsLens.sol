// SPDX-License-Identifier: MITrewardTokens
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import "./Interfaces.sol";

contract EarmarkRewardsLens {
    IStaker public voterProxy;
    IBooster public booster;
    IBoosterEarmark public boosterEarmark;
    address public crv;
    uint256 public maxPidsToExecute;

    constructor(IStaker _voterProxy, uint256 _maxPidsToExecute) {
        voterProxy = _voterProxy;
        maxPidsToExecute = _maxPidsToExecute;
        updateBooster();
    }

    function updateBooster() public {
        booster = IBooster(voterProxy.operator());
        boosterEarmark = IBoosterEarmark(booster.earmarkDelegate());
        crv = booster.crv();
    }

    function getRewards() public view returns(
        address[] memory tokens,
        string[] memory tokensSymbols,
        uint256[] memory boosterPendingRewards,
        uint256[] memory wombatPendingRewards,
        uint256[] memory availableBalances,
        int256[] memory diffBalances
    ) {
        tokens = boosterEarmark.distributionTokenList();
        tokensSymbols = new string[](tokens.length);
        boosterPendingRewards = new uint256[](tokens.length);
        wombatPendingRewards = new uint256[](tokens.length);
        availableBalances = new uint256[](tokens.length);
        diffBalances = new int256[](tokens.length);

        uint256 poolLen = booster.poolLength();

        for (uint256 i = 0; i < tokens.length; i++) {
            try ERC20(tokens[i]).symbol() returns (string memory symbol) {
                tokensSymbols[i] = symbol;
            } catch {

            }
            for (uint256 j = 0; j < poolLen; j++) {
                IBooster.PoolInfo memory poolInfo = booster.poolInfo(j);
                boosterPendingRewards[i] += booster.lpPendingRewards(poolInfo.lptoken, tokens[i]);

                uint256 wmPid = voterProxy.lpTokenToPid(poolInfo.gauge, poolInfo.lptoken);
                (
                    uint256 pendingRewards,
                    IERC20[] memory bonusTokenAddresses,
                    ,
                    uint256[] memory pendingBonusRewards
                ) = IMasterWombatV2(poolInfo.gauge).pendingTokens(wmPid, address(voterProxy));

                if (tokens[i] == crv) {
                    wombatPendingRewards[i] += pendingRewards;
                }

                for (uint256 k = 0; k < bonusTokenAddresses.length; k++) {
                    if (address(bonusTokenAddresses[k]) == tokens[i]) {
                        wombatPendingRewards[i] += pendingBonusRewards[k];
                    }
                }
            }
            availableBalances[i] = IERC20(tokens[i]).balanceOf(address(booster)) + IERC20(tokens[i]).balanceOf(address(voterProxy));

            diffBalances[i] = int256(wombatPendingRewards[i]) + int256(availableBalances[i]) - int256(boosterPendingRewards[i]);
        }
    }


    function getEarmarkablePools() public view returns(bool[] memory earmarkablePools, uint256 poolsCount) {
        uint256 poolLen = booster.poolLength();
        earmarkablePools = new bool[](poolLen);

        for (uint256 i = 0; i < poolLen; i++) {
            IBooster.PoolInfo memory p = booster.poolInfo(i);
            if (p.shutdown || !boosterEarmark.isEarmarkPoolAvailable(i, p)) {
                continue;
            }

            (address token , uint256 periodFinish, , , , , , , bool paused) = IRewards(p.crvRewards).tokenRewards(crv);
            if (token == crv && periodFinish < block.timestamp && IERC20(crv).balanceOf(p.crvRewards) > 1000 ether) {
                earmarkablePools[i] = true;
                continue;
            }

            (uint256 pendingRewards, , , uint256[] memory pendingBonusRewards) = IMasterWombatV2(p.gauge).pendingTokens(i, address(voterProxy));
            if (pendingRewards != 0) {
                earmarkablePools[i] = true;
                poolsCount++;
                continue;
            }
            for (uint256 j = 0; j < pendingBonusRewards.length; j++) {
                if (pendingBonusRewards[j] != 0) {
                    earmarkablePools[i] = true;
                    poolsCount++;
                    break;
                }
            }
        }
    }

    function getPidsToEarmark() public view returns(uint256[] memory pids) {
        (bool[] memory earmarkablePools, uint256 poolsCount) = getEarmarkablePools();
        pids = new uint256[](poolsCount);
        uint256 curIndex = 0;
        for (uint256 i = 0; i < earmarkablePools.length; i++) {
            if (earmarkablePools[i]) {
                pids[curIndex] = i;
                curIndex++;
            }
        }
    }

    function earmarkResolver() public view returns(bool execute, bytes memory data) {
        uint256[] memory pidsToExecute = getPidsToEarmark();
        if (pidsToExecute.length > maxPidsToExecute) {
            uint256[] memory pids = new uint256[](maxPidsToExecute);
            for (uint256 i = 0; i < maxPidsToExecute; i++) {
                pids[i] = pidsToExecute[i];
            }
            pidsToExecute = pids;
        }
        return (
            pidsToExecute.length > 0,
            abi.encodeWithSelector(IBoosterEarmark.earmarkRewards.selector, pidsToExecute)
        );
    }

    function getPoolsQueue() public view returns(uint256[] memory pidsNextExecuteOn) {
        uint256 poolLen = booster.poolLength();
        pidsNextExecuteOn = new uint256[](poolLen);
        for (uint256 i = 0; i < poolLen; i++) {
            pidsNextExecuteOn[i] = boosterEarmark.getEarmarkPoolExecuteOn(i);
        }
    }
}
