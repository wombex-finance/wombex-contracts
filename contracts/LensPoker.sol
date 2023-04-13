// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";

contract LensPoker {
    IStaker public voterProxy;
    IBooster public booster;
    address public wom;

    struct PokerPool {
        uint256 pid;
        uint256 womPending;
        uint256 womToDistribute;
        int256 womDiff;
    }

    constructor(address _voterProxy) {
        voterProxy = IStaker(_voterProxy);
        updateBooster();
    }

    function updateBooster() public {
        booster = IBooster(voterProxy.operator());
        wom = booster.crv();
    }

    function getPoolsToPoke1() public view returns(uint256[] memory) {
        return getPokeRequiredPoolIds(false);
    }
    function getPoolsToPoke2() public view returns(uint256[] memory) {
        return getPokeRequiredPoolIds(true);
    }

    function getPokeRequiredPoolIds(bool checkPeriodFinished) public view returns(uint256[] memory) {
        uint256 len = booster.poolLength();
        uint256 requiredLen = 0;
        bool[] memory pokeRequired = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(i);

            // 0. Ignore if the pool is shut down
            if (poolInfo.shutdown) {
                continue;
            }

            // 1. Ignore if reward distribution paused
            uint256 womPending = getWomRewardsByPool(poolInfo);
            if (womPending == 0) {
                continue;
            }

            if (checkPeriodFinished) {
                // 2. Ignore if periodFinished is not happened yet
                (, uint256 periodFinish, , , , , , ,) = IRewards(poolInfo.crvRewards).tokenRewards(wom);
                if (periodFinish > block.timestamp) {
                    continue;
                }
            }

            // Push to the results list
            pokeRequired[i] = true;
            requiredLen++;
        }

        uint256[] memory result = new uint256[](requiredLen);
        uint256 j = 0;

        for (uint256 i = 0; i < len; i++) {
            if (pokeRequired[i]) {
                result[j++] = i;
            }
        }

        return result;
    }

    function getPokeRequiredPendingPools(bool checkPeriodFinished, bool useBalanceToDiff) public view returns(uint256 availableBalance, PokerPool[] memory pools) {
        uint256[] memory pids = getPokeRequiredPoolIds(checkPeriodFinished);
        uint256 len = pids.length;

        pools = new PokerPool[](len);

        availableBalance = IERC20(wom).balanceOf(address(booster)) + IERC20(wom).balanceOf(address(voterProxy));

        uint256 balanceToUse = useBalanceToDiff ? availableBalance : 0;
        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(pids[i]);
            uint256 womPending = getWomRewardsByPool(poolInfo);

            uint256 womToDistribute = booster.lpPendingRewards(poolInfo.lptoken, wom);
            int256 diff = int256(womPending) - int256(womToDistribute);
            if (useBalanceToDiff) {
                if (womToDistribute > 0) {
                    balanceToUse -= (womToDistribute > balanceToUse ? balanceToUse : womToDistribute);
                }
                if (diff < 0) {
                    uint256 newBalanceToUse = balanceToUse - (uint256(diff * -1) > balanceToUse ? balanceToUse : uint256(diff * -1));
                    diff += int256(balanceToUse);
                    balanceToUse = newBalanceToUse;
                }
            }
            pools[i] = PokerPool(pids[i], womPending, womToDistribute, diff);
        }

        if (useBalanceToDiff) {
            availableBalance = balanceToUse;
        }
    }

    function getWomRewardsByPool(IBooster.PoolInfo memory poolInfo) public view returns(uint256) {
        uint256 wmPid = voterProxy.lpTokenToPid(poolInfo.gauge, poolInfo.lptoken);
        (
            uint256 womPending,
            IERC20[] memory bonusTokenAddresses,
            ,
            uint256[] memory pendingBonusRewards
        ) = IMasterWombatV2(poolInfo.gauge).pendingTokens(wmPid, address(voterProxy));

        for (uint256 k = 0; k < bonusTokenAddresses.length; k++) {
            if (address(bonusTokenAddresses[k]) == wom) {
                womPending += pendingBonusRewards[k];
            }
        }
        return womPending;
    }
}
