// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";

/**
 * @title   GaugeVoting
 * @author  WombexFinance
 */
contract GaugeVoting is Ownable {
    IWmxLocker public wmxLocker;
    IBooster public booster;
    IBribeVoter public bribeVoter;

    mapping(address => uint256) votedForLpToken;
    mapping(address => uint256) userVotes;
    mapping(address => address[]) userLpTokens;
    mapping(address => mapping(address => uint256)) userLpVotes;

    struct LpTokenData {
        address stakingToken;
        address rewards;
    }
    mapping(uint256 => LpTokenData) lpTokenData;

    enum LpTokenStatus {
        NOT_EXISTS,
        ADDED,
        ACTIVE
    }
    mapping(address => LpTokenStatus) lpTokenStatus;
    address[] lpTokensAdded;

    event SetEarmarkConfig(uint256 earmarkPeriod);
    event AddLpToken(address lpToken);
    event SetLpTokenStatus(address lpToken, LpTokenStatus status);

    constructor(
        IWmxLocker _wmxLocker,
        IBooster _booster,
        IBribeVoter _bribeVoter
    ) public {
        wmxLocker = _wmxLocker;
        booster = _booster;
        bribeVoter = _bribeVoter;
    }

    function setVotingConfig(uint256 _earmarkPeriod) public onlyOwner {
        earmarkPeriod = _earmarkPeriod;
        emit SetEarmarkConfig(_earmarkPeriod);
    }

    function setFactories(address _tokenFactory, address _rewardFactory) public onlyOwner {
        tokenFactory = _tokenFactory;
        rewardFactory = _rewardFactory;
        emit SetEarmarkConfig(_earmarkPeriod);
    }

    function addLpToken(address _lpToken) public onlyOwner {
        require(lpTokenStatus[_lpToken] == LpTokenStatus.NOT_EXISTS, "already exists");
        lpTokenStatus[_lpToken] = LpTokenStatus.ACTIVE;
        lpTokensAdded.push(_lpToken);

        address stakingToken = ITokenFactory(tokenFactory).CreateDepositToken(_lpToken);
        address rewards = IRewardFactory(rewardFactory).CreateCrvRewards(0, stakingToken, _lpToken);

        lpTokenData[_lpToken] = LpTokenData()

        emit AddLpToken(_lpToken);
    }

    function setLpTokenStatus(address _lpToken, LpTokenStatus _status) public onlyOwner {
        require(lpTokenStatus[_lpToken] != LpTokenStatus.NOT_EXISTS, "already exists");
        lpTokenStatus[_lpToken] = _status;
        emit SetLpTokenStatus(_lpToken, _status);
    }

    function vote(address[] memory _lpTokens, int256[] memory _deltas) public {
        require(userVotes[curVotesTimestamp][msg.sender] == 0, "already voted");

        uint256 len = _lpTokens.length;
        require(len == _deltas.length, "!len");
        uint256 votes = wmxLocker.getVotes(msg.sender);
        require(votes != 0, "no votes");

        int256 deltaSum = 0;
        for (uint256 i = 0; i < len; i++) {
            address lpToken = _lpTokens[i];
            uint256 delta = _deltas[i];
            uint256 totalLpVotes = votedForLpToken[lpToken];
            deltaSum += delta;
            if (delta > 0) {
                userLpVotes[msg.sender][lpToken] += uint256(delta);
                votedForLpToken[lpToken] = totalLpVotes + uint256(delta);
            } else {
                require(userLpVotes[msg.sender][lpToken] >= uint256(-delta), 'voter: vote underflow');
                userLpVotes[msg.sender][lpToken] -= uint256(-delta);
                weights[lpToken].voteWeight = totalLpVotes - uint256(-delta);
            }

            userLpVotes[msg.sender][lpToken] =
            votedForLpToken[lpToken] += votes * uint256(_deltas[i] / deltaSum);
        }
        require(deltaSum == votes, "!deltaSum");

        if (userVotes[curVotesTimestamp][msg.sender] == 0) {
            userVotes[curVotesTimestamp][msg.sender] = votes;
            totalVotes[curVotesTimestamp] += votes;
        }
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
        emit VotingStarted(curVotesTimestamp);
    }

    function totalVotes() public returns (uint256) {
        uint256 len = lpTokensAdded.length;
        uint256 sum = 0;
        for (uint256 i = 0; i < len; i++) {
            sum += votedForLpToken[lpTokensAdded[i]];
        }
        return sum;
    }
}
