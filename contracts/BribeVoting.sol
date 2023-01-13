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
contract BribeVoting {
    int256 public constant DENOMINATOR = 10000;

    IWmxLocker public wmxLocker;
    IBooster public booster;
    IBribeVoter public bribeVoter;
    uint256 public threshold;

    uint256 public curVotesTimestamp;
    uint256 public cutTotalVotes;

    mapping(uint256 => mapping(address => uint256)) votedForLpToken;

    constructor(IWmxLocker _wmxLocker, IBooster _booster, IBribeVoter _bribeVoter, uint256 _threshold) public {
        wmxLocker = _wmxLocker;
        booster = _booster;
        bribeVoter = _bribeVoter;
        threshold = _threshold;
    }

    function vote(address[] memory _lpTokens, int256[] memory _deltas) public {
        uint256 len = _lpTokens.length;
        require(len == _deltas.length, "!len");
        uint256 votes = wmxLocker.getPastVotes(msg.sender, curVotesTimestamp);

        int256 deltaSum = 0;
        for (uint256 i = 0; i < len; i++) {
            deltaSum += _deltas[i];
        }
        require(deltaSum == DENOMINATOR, "!deltaSum");
        for (uint256 i = 0; i < len; i++) {
            address lpToken = _lpTokens[i];
            votedForLpToken[curVotesTimestamp][lpToken] += votes * uint256(deltaSum / _deltas[i]);
        }
        cutTotalVotes += votes;
    }

    function execute(address[] memory _lpTokens) public {
        require(cutTotalVotes >= threshold, "!threshold");
        uint256 len = _lpTokens.length;
        int256[] memory _deltas = new int256[](len);

        for (uint256 i = 0; i < len; i++) {
            address lpToken = _lpTokens[i];
            _deltas[i] = int256(votedForLpToken[curVotesTimestamp][lpToken] * 1 ether / cutTotalVotes);
        }

        booster.voteExecute(
            address(bribeVoter),
            0,
            abi.encodeWithSelector(IBribeVoter.vote.selector, _lpTokens, _deltas)
        );

        curVotesTimestamp = block.timestamp;
        cutTotalVotes = 0;
    }
}
