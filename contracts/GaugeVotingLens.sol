// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./GaugeVoting.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";

/**
 * @title   GaugeVotingLens
 * @author  WombexFinance
 */
contract GaugeVotingLens {
    GaugeVoting public gaugeVoting;

    struct Pool {
        address lpToken;
        address rewards;
        bool isActive;
        int256 votes;
        int256 delta;
        string name;
        string symbol;
    }

    constructor(GaugeVoting _gaugeVoting) {
        gaugeVoting = _gaugeVoting;
    }

    function getPools() public returns (Pool[] memory pools) {
        address[] memory lpTokens = gaugeVoting.getLpTokensAdded();
        (int256[] memory deltas, int256[] memory votes) = gaugeVoting.getVotesDelta();
        pools = new Pool[](lpTokens.length);
        for(uint256 i = 0; i < lpTokens.length; i++) {
            pools[i] = Pool(lpTokens[i], gaugeVoting.lpTokenRewards(lpTokens[i]), uint256(gaugeVoting.lpTokenStatus(lpTokens[i])) == 2, votes[i], deltas[i], ERC20(lpTokens[i]).name(), ERC20(lpTokens[i]).symbol());
        }
    }
}
