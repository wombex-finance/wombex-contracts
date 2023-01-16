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
    address public voterProxy;
    IERC20 public veWom;

    ITokenFactory tokenFactory;
    IBribesRewardFactory bribeRewardsFactory;

    mapping(address => uint256) votedForLpToken;
    mapping(address => uint256) userVotes;
    mapping(address => address[]) userLpTokens;
    mapping(address => mapping(address => uint256)) userLpVotes;

    struct LpTokenData {
        address rewards;
    }
    mapping(address => LpTokenData) lpTokenData;

    enum LpTokenStatus {
        NOT_EXISTS,
        ADDED,
        ACTIVE
    }
    mapping(address => LpTokenStatus) lpTokenStatus;
    address[] lpTokensAdded;

    ITokenMinter stakingToken;
    uint256 earmarkPeriod;

    event SetEarmarkConfig(uint256 earmarkPeriod);
    event SetFactories(address tokenFactory, address rewardFactory);
    event AddLpToken(address lpToken);
    event SetLpTokenStatus(address lpToken, LpTokenStatus status);

    constructor(
        IWmxLocker _wmxLocker,
        IBooster _booster,
        IBribeVoter _bribeVoter
    ) public {
        wmxLocker = _wmxLocker;
        booster = _booster;
        voterProxy = _booster.voterProxy();
        veWom = IERC20(IStaker(voterProxy).veWom);
        bribeVoter = _bribeVoter;
    }

    function setVotingConfig(uint256 _earmarkPeriod) public onlyOwner {
        earmarkPeriod = _earmarkPeriod;
        emit SetEarmarkConfig(_earmarkPeriod);
    }

    function setFactories(address _tokenFactory, address _rewardFactory) public onlyOwner {
        require(tokenFactory == address(0), "!zero");
        tokenFactory = ITokenFactory(_tokenFactory);
        bribeRewardsFactory = IBribesRewardFactory(_rewardFactory);

        stakingToken = ITokenMinter(tokenFactory.CreateDepositToken(address(wmxLocker)));

        emit SetFactories(_tokenFactory, _rewardFactory);
    }

    function addLpToken(address _lpToken) public onlyOwner {
        require(lpTokenStatus[_lpToken] == LpTokenStatus.NOT_EXISTS, "already exists");
        lpTokenStatus[_lpToken] = LpTokenStatus.ACTIVE;
        lpTokensAdded.push(_lpToken);

        address rewards = bribeRewardsFactory.CreateBribesRewards(stakingToken, _lpToken);

        lpTokenData[_lpToken] = LpTokenData(rewards);

        emit AddLpToken(_lpToken);
    }

    function setLpTokenStatus(address _lpToken, LpTokenStatus _status) public onlyOwner {
        require(lpTokenStatus[_lpToken] != LpTokenStatus.NOT_EXISTS, "already exists");
        lpTokenStatus[_lpToken] = _status;
        emit SetLpTokenStatus(_lpToken, _status);
    }

    function vote(address[] memory _lpTokens, int256[] memory _deltas) public {
        uint256 len = _lpTokens.length;
        require(len == _deltas.length, "!len");
        uint256 votes = wmxLocker.getVotes(msg.sender);
        require(votes != 0, "no votes");

        uint256 userLockerVotes = wmxLocker.getVotes(msg.sender) * nftLocker.voteBoost(msg.sender) / 1 ether;
        int256 lastDelta = 0;
        uint256 totalVotedByUser = 0;

        for (uint256 i = 0; i < len; i++) {
            require(i == 0 || _deltas[i] > lastDelta, "< lastDelta");
            lastDelta = _deltas[i];
            address rewards = lpTokenData[_lpTokens[i]].rewards;

            IBribeRewardsPool rewardsPool = IBribeRewardsPool(rewards);
            uint256 amount = _deltas[i] < 0 ? int256(-_deltas[i]) : int256(-_deltas[i]);
            if (_deltas[i] < 0) {
                userVotes[msg.sender] -= amount;
                IRewards(rewards).withdrawAndUnwrapFrom(msg.sender, amount, msg.sender);
                stakingToken.burn(address(rewardsPool), amount);
            } else if (_deltas[i] > 0) {
                userVotes[msg.sender] += amount;
                stakingToken.mint(address(this), amount);
                IRewards(rewards).stakeFor(msg.sender, amount);
            }
        }

        require(userVotes[msg.sender] <= userLockerVotes, "votes overflow");

        _execute();
    }

    function _execute() internal {
        uint256 totalLpVotes = totalVotes();
        uint256 veWomTotalSupply = veWom.totalSupply();
        uint256 ratio = veWomTotalSupply * 1 ether / totalLpVotes;

        uint256 len = lpTokensAdded.length;
        int256[] memory _deltas = new int256[](len);
        for (uint256 i = 0; i < len; i++) {
            address lpToken = lpTokensAdded[i];
            address rewardsPool = lpTokenData[lpToken].rewards;
            uint256 lpVotes = int256(IERC20(rewardsPool).totalSupply() * ratio);
            uint256 bribeVotes = bribeVoter.votes(voterProxy, lpToken);
            _deltas[i] = lpVotes - bribeVotes;
        }

        bytes memory rewardsData = booster.voteExecute(
            address(bribeVoter),
            0,
            abi.encodeWithSelector(IBribeVoter.vote.selector, lpTokensAdded, _deltas)
        );
        //TODO: encode rewards and distribute to rewards contract(queueRewards)

    }

    function totalVotes() public returns (uint256) {
        return IERC20(lpTokenData[lpToken].stakingToken).totalSupply();
    }
}
