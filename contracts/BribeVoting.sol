// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";

/**
 * @title   BribeVoting
 * @author  WombexFinance
 */
contract BribeVoting is Ownable {
    int256 public constant DENOMINATOR = 10000;

    IWmxLocker public wmxLocker;
    IBooster public booster;
    IBribeVoter public bribeVoter;
    uint256 public threshold;
    uint256 public period;

    uint256 public curVotesTimestamp;

    mapping(uint256 => mapping(address => uint256)) votedForLpToken;
    mapping(uint256 => mapping(address => uint256)) userVotes;
    mapping(uint256 => uint256) totalVotes;

    mapping(uint256 => address[]) rewardTokens;
    mapping(uint256 => mapping(address => uint256)) rewards;

    constructor(IWmxLocker _wmxLocker, IBooster _booster, IBribeVoter _bribeVoter, uint256 _threshold) public {
        wmxLocker = _wmxLocker;
        booster = _booster;
        bribeVoter = _bribeVoter;
        threshold = _threshold;
    }

    function setVotingConfig(uint256 _threshold, uint256 _period) public onlyOwner {
        threshold = _threshold;
        period = _period;
    }

    function vote(address[] memory _lpTokens, int256[] memory _deltas) public {
        require(userVotes[curVotesTimestamp][msg.sender] == 0, "already voted");

        uint256 len = _lpTokens.length;
        require(len == _deltas.length, "!len");
        uint256 votes = wmxLocker.getPastVotes(msg.sender, curVotesTimestamp);
        require(votes == 0, "no votes");

        int256 deltaSum = 0;
        for (uint256 i = 0; i < len; i++) {
            deltaSum += _deltas[i];
        }
        require(deltaSum == DENOMINATOR, "!deltaSum");
        for (uint256 i = 0; i < len; i++) {
            address lpToken = _lpTokens[i];
            votedForLpToken[curVotesTimestamp][lpToken] += votes * uint256(deltaSum / _deltas[i]);
        }
        userVotes[curVotesTimestamp][msg.sender] += votes;
        totalVotes[curVotesTimestamp] += votes;
    }

    function execute(address[] memory _lpTokens) public {
        uint256 cutTotalVotes = totalVotes[curVotesTimestamp];
        require(cutTotalVotes >= threshold, "!threshold");
        require(curVotesTimestamp + period < block.timestamp, "!period");

        uint256 len = _lpTokens.length;
        int256[] memory _deltas = new int256[](len);

        for (uint256 i = 0; i < len; i++) {
            address lpToken = _lpTokens[i];
            _deltas[i] = int256(votedForLpToken[curVotesTimestamp][lpToken] * 1 ether / cutTotalVotes);
        }

        bytes memory rewardsData = booster.voteExecute(
            address(bribeVoter),
            0,
            abi.encodeWithSelector(IBribeVoter.vote.selector, _lpTokens, _deltas)
        );
        //TODO: encode rewards and write to rewardTokens and rewards mapping for distribution

        curVotesTimestamp = block.timestamp;
    }
}
