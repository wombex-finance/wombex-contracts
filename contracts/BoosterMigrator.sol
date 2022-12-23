// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-0.6/access/Ownable.sol";
import "./vendor/Booster.sol";
import "./vendor/TokenFactory.sol";
import "./vendor/RewardFactory.sol";

contract BoosterMigrator is Ownable {

    event Migrated(address newBooster, uint256 poolLength);
    event CallContract(address indexed contractAddress, bytes callData, bool success, bytes returnData);

    Booster public oldBooster;
    Booster public newBooster;
    RewardFactory public rewardFactory;
    TokenFactory public tokenFactory;
    address public boosterOwner;
    address public weth;

    constructor(Booster _oldBooster, Booster _newBooster, RewardFactory _rewardFactory, TokenFactory _tokenFactory, address _weth) public {
        oldBooster = _oldBooster;
        newBooster = _newBooster;
        rewardFactory = _rewardFactory;
        tokenFactory = _tokenFactory;
        boosterOwner = _oldBooster.owner();
        weth = _weth;
    }

    function migrate() external onlyOwner {
        uint256 poolLen = oldBooster.poolLength();
        uint256 activePoolLen = 0;

        uint256[] memory lpBalances = new uint256[](poolLen);
        for (uint256 i = 0; i < poolLen; i++) {
            (address lptoken, , , , bool shutdown) = oldBooster.poolInfo(i);
            if (shutdown) {
                continue;
            }
            oldBooster.earmarkRewards(i);
            lpBalances[i] = IERC20(lptoken).balanceOf(address(oldBooster));
            activePoolLen++;
        }

        require(oldBooster.voterProxy() == newBooster.voterProxy(), "!voterProxy");
        require(oldBooster.cvx() == newBooster.cvx(), "!cvx");
        require(oldBooster.crv() == newBooster.crv(), "!crv");

        IStaker voterProxy = IStaker(oldBooster.voterProxy());

        voterProxy.setOperator(address(newBooster));
        oldBooster.shutdownSystem();

        address[] memory crvRewards = new address[](poolLen + 1);
        uint256[] memory pids = new uint256[](poolLen + 1);

        for (uint256 i = 0; i < poolLen; i++) {
            (address lptoken, , , address rewards, bool shutdown) = oldBooster.poolInfo(i);
            if (shutdown) {
                continue;
            }
            pids[i] = i;
            crvRewards[i] = rewards;
            require(lpBalances[i] == IERC20(lptoken).balanceOf(address(oldBooster)), "lp_balance");
        }

        crvRewards[poolLen] = oldBooster.crvLockRewards();
        pids[poolLen] = type(uint256).max;

        oldBooster.migrateRewards(crvRewards, pids, address(newBooster));

        newBooster.setFeeManager(address(this));

        for (uint256 i = 0; i < poolLen; i++) {
            (address lptoken, address token, address gauge, address rewards, bool shutdown) = oldBooster.poolInfo(i);
            if (shutdown) {
                continue;
            }

            newBooster.addCreatedPool(lptoken, gauge, token, rewards);
        }

        require(newBooster.poolLength() == activePoolLen, "active_pool_len");

        address[] memory distroTokens = oldBooster.distributionTokenList();
        for (uint256 i = 0; i < distroTokens.length; i++) {
            uint256 tokenDistroLength = oldBooster.distributionByTokenLength(distroTokens[i]);
            address[] memory distros = new address[](tokenDistroLength);
            uint256[] memory shares = new uint256[](tokenDistroLength);
            bool[] memory callQueues = new bool[](tokenDistroLength);
            for (uint256 j = 0; j < tokenDistroLength; j++) {
                (distros[j], shares[j], callQueues[j]) = oldBooster.distributionByTokens(distroTokens[i], j);
            }
            newBooster.updateDistributionByTokens(distroTokens[i], distros, shares, callQueues);
        }

        require(address(newBooster) == tokenFactory.operator(), "!tokenFactory.operator");
        checkStrings(TokenFactory(oldBooster.tokenFactory()).namePostfix(), tokenFactory.namePostfix(), "!namePostfix");
        checkStrings(TokenFactory(oldBooster.tokenFactory()).symbolPrefix(), tokenFactory.symbolPrefix(), "!symbolPrefix");
        require(address(newBooster) == rewardFactory.operator(), "!rewardFactory.operator");
        require(RewardFactory(oldBooster.rewardFactory()).crv() == rewardFactory.crv(), "!tokenFactory.crv");

        newBooster.setFactories(address(rewardFactory), address(tokenFactory));
        newBooster.setExtraRewardsDistributor(address(oldBooster.extraRewardsDist()));
        newBooster.setLockRewardContracts(oldBooster.crvLockRewards(), oldBooster.cvxLocker());
        newBooster.setVoteDelegate(oldBooster.voteDelegate());
        newBooster.setEarmarkIncentive(oldBooster.earmarkIncentive());
        newBooster.setFeeManager(oldBooster.feeManager());

        IMinter(oldBooster.cvx()).updateOperator();

        require(IMinter(oldBooster.cvx()).operator() == address(newBooster), "!operator");

        oldBooster.setOwner(boosterOwner);
        voterProxy.setOwner(boosterOwner);

        newBooster.setPoolManager(boosterOwner);
        newBooster.setOwner(boosterOwner);

        emit Migrated(address(newBooster), newBooster.poolLength());
    }

    function checkStrings(string memory arg1, string memory arg2, string memory errorMessage) internal {
        require(keccak256(abi.encodePacked(arg1)) == keccak256(abi.encodePacked(arg2)), errorMessage);
    }

    function callContract(address _contract, bytes calldata _data) external {
        require(msg.sender == boosterOwner, "!auth");
        (bool success, bytes memory returndata) = _contract.call(_data);

        emit CallContract(_contract, _data, success, _data);
    }
}
