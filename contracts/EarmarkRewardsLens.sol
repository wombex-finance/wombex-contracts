// SPDX-License-Identifier: MITrewardTokens
pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import "./Interfaces.sol";

contract EarmarkRewardsLens {
    IStaker public voterProxy;
    IBooster public booster;
    IBoosterEarmark public boosterEarmark;
    address public crv;
    constructor(IStaker _voterProxy) {
        voterProxy = _voterProxy;
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
}
