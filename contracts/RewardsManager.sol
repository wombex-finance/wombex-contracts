// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

contract RewardsManager is Ownable {
    IBooster public booster;
    address public voterProxy;
    IBoosterEarmark public boosterEarmark;
    IWmxLocker public wmxLocker;
    IRewards public wmxWomRewards;

    address[] public defaultDistros;
    uint256[] public defaultShares;
    bool[] public defaultCallQueue;

    event UpdateBooster(address booster, address boosterEarmark);
    event SetDefaultTokenDistro(address[] distros, uint256[] shares, bool[] callQueue);
    event OnNewRewardToken(address token);

    constructor(address _booster, address _wmxLocker) {
        booster = IBooster(_booster);
        boosterEarmark = IBoosterEarmark(booster.earmarkDelegate());
        voterProxy = IBooster(_booster).voterProxy();
        wmxLocker = IWmxLocker(booster.cvxLocker());
        wmxWomRewards = IRewards(booster.crvLockRewards());
    }

    function updateBooster() external onlyOwner {
        booster = IBooster(IStaker(voterProxy).operator());
        boosterEarmark = IBoosterEarmark(booster.earmarkDelegate());
        emit UpdateBooster(address(booster), address(boosterEarmark));
    }

    function setDefaultTokenDistro(address[] memory _distros, uint256[] memory _shares, bool[] memory _callQueue) external onlyOwner {
        defaultDistros = _distros;
        defaultShares = _shares;
        defaultCallQueue = _callQueue;
        emit SetDefaultTokenDistro(_distros, _shares, _callQueue);
    }

    function onNewRewardToken(address _token) external {
        require(address(boosterEarmark) == msg.sender || owner() == msg.sender, "not_booster_earmark_nor_owner");
        boosterEarmark.updateDistributionByTokens(_token, defaultDistros, defaultShares, defaultCallQueue);
        wmxLocker.addReward(_token, address(booster));
        emit OnNewRewardToken(_token);
    }

    function addReward(address _rewardsToken, address _distributor) external onlyOwner {
        wmxLocker.addReward(_rewardsToken, _distributor);
    }

    function approveRewardDistributor(
        address _rewardsToken,
        address _distributor,
        bool _approved
    ) external onlyOwner {
        wmxLocker.approveRewardDistributor(_rewardsToken, _distributor, _approved);
    }

    function modifyBlacklist(address _account, bool _blacklisted) external onlyOwner {
        wmxLocker.modifyBlacklist(_account, _blacklisted);
    }

    function setKickIncentive(uint256 _rate, uint256 _delay) external onlyOwner {
        wmxLocker.setKickIncentive(_rate, _delay);
    }

    function shutdown() external onlyOwner {
        wmxLocker.shutdown();
    }

    function recoverERC20(address _tokenAddress, uint256 _tokenAmount) external onlyOwner {
        wmxLocker.recoverERC20(_tokenAddress, _tokenAmount);
    }

    function lockerTransferOwnership(address _newOwner) external onlyOwner {
        IOwnable(address(wmxLocker)).transferOwnership(_newOwner);
    }

    function getDefaultTokenDistro() external view returns (address[] memory distros, uint256[] memory shares, bool[] memory callQueue) {
        distros = defaultDistros;
        shares = defaultShares;
        callQueue = defaultCallQueue;
    }
}
