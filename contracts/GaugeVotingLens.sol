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
        uint256 vlVotes;
        int256 vlDelta;
        bool isActive;
        int256 veWomVotes;
        int256 veWomDelta;
        string name;
        string symbol;
    }

    struct UserReward {
        address lpToken;
        address rewards;
        address rewardToken;
        uint256 rewardAmount;
    }

    constructor(GaugeVoting _gaugeVoting) {
        gaugeVoting = _gaugeVoting;
    }

    function getPools() public view returns (Pool[] memory pools) {
        address[] memory lpTokens = gaugeVoting.getLpTokensAdded();
        (int256[] memory deltas, int256[] memory votes) = gaugeVoting.getVotesDelta();
        if (deltas.length == 0) {
            deltas = new int256[](lpTokens.length);
            votes = new int256[](lpTokens.length);
        }
        pools = new Pool[](lpTokens.length);
        for (uint256 i = 0; i < lpTokens.length; i++) {
            address rewards = gaugeVoting.lpTokenRewards(lpTokens[i]);
            uint256 vlVotes = IERC20(rewards).totalSupply();
            int256 ratio;
            int256 vlDelta;
            if (votes[i] != 0) {
                ratio = int256(vlVotes) * int256(1 ether) / votes[i];
                vlDelta = deltas[i] * ratio / int256(1 ether);
            }
            pools[i] = Pool(lpTokens[i], rewards, vlVotes, vlDelta, uint256(gaugeVoting.lpTokenStatus(lpTokens[i])) == 2, votes[i], deltas[i], ERC20(lpTokens[i]).name(), ERC20(lpTokens[i]).symbol());
        }
    }

    function getUserVotes(address _user) public view returns (uint256[] memory votes) {
        address[] memory lpTokens = gaugeVoting.getLpTokensAdded();
        votes = new uint256[](lpTokens.length);
        for(uint256 i = 0; i < lpTokens.length; i++) {
            votes[i] = IERC20(gaugeVoting.lpTokenRewards(lpTokens[i])).balanceOf(_user);
        }
    }

    function getUserRewards(address _user, uint256 _rewardsPerLpToken) public view returns (UserReward[] memory rewards) {
        IBribeVoter bribeVoter = gaugeVoting.bribeVoter();

        address[] memory lpTokens = gaugeVoting.getLpTokensAdded();
        rewards = new UserReward[](lpTokens.length * _rewardsPerLpToken);
        uint256 rIndex = 0;

        address[] memory rewardPools = new address[](lpTokens.length);
        uint256[] memory balances = new uint256[](lpTokens.length);
        for (uint256 j = 0; j < lpTokens.length; j++) {
            rewardPools[j] = gaugeVoting.lpTokenRewards(lpTokens[j]);
            balances[j] = IBribeRewardsPool(rewardPools[j]).balanceOf(_user);

            address[] memory bribeRewardTokens = IBribeRewardsPool(rewardPools[j]).rewardTokensList();
            for (uint256 i = 0; i < bribeRewardTokens.length; i++) {
                bool added = false;
                for (uint256 k = 0; k < rIndex; k++) {
                    if (rewards[k].rewardToken == bribeRewardTokens[i]) {
                        added = true;
                        break;
                    }
                }
                if (added) {
                    continue;
                }
                rewards[i] = UserReward(lpTokens[j], rewardPools[j], bribeRewardTokens[i], 0);
                rIndex++;
            }
        }
        for (uint256 i = 0; i < rewards.length; i++) {
            for (uint256 j = 0; j < lpTokens.length; j++) {
                if (balances[j] == 0) {
                    continue;
                }
                rewards[i].rewardAmount += IBribeRewardsPool(rewardPools[j]).earned(rewards[i].rewardToken, _user);
            }
        }
    }
}
