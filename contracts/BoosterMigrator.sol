// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-0.6/access/Ownable.sol";
import "./vendor/Booster.sol";
import "hardhat/console.sol";

contract BoosterMigrator is Ownable {

    event Migrated(address newBooster, uint256 poolLength);
    event CallContract(address indexed contractAddress, bytes callData, bool success, bytes returnData);

    Booster public oldBooster;
    address public boosterOwner;

    constructor(Booster _oldBooster) public {
        oldBooster = _oldBooster;
        boosterOwner = _oldBooster.owner();
    }

    function migrate() external onlyOwner {
        IStaker voterProxy = IStaker(oldBooster.voterProxy());

        Booster newBooster = new Booster(address(voterProxy), oldBooster.cvx(), oldBooster.crv(), 2000, 15000);

        voterProxy.setOperator(address(newBooster));
        oldBooster.shutdownSystem();

        uint256 poolLen = oldBooster.poolLength();
        address[] memory crvRewards = new address[](poolLen + 1);
        uint256[] memory pids = new uint256[](poolLen + 1);

        for (uint256 i = 0; i < poolLen; i++) {
            (, , , address rewards, bool shutdown) = oldBooster.poolInfo(i);
            if (shutdown) {
                continue;
            }
            pids[i] = i;
            crvRewards[i] = rewards;
        }

        crvRewards[poolLen] = oldBooster.crvLockRewards();
        pids[poolLen] = 0;

        oldBooster.migrateRewards(crvRewards, pids, address(newBooster));

        for (uint256 i = 0; i < poolLen; i++) {
            (address lptoken, address token, address gauge, address rewards, bool shutdown) = oldBooster.poolInfo(i);
            if (shutdown) {
                continue;
            }

            newBooster.addCreatedPool(lptoken, gauge, token, rewards);
        }

        address[] memory distroTokens = oldBooster.distributionTokenList();
        for (uint256 i = 0; i < distroTokens.length; i++) {
            console.log("distroTokens[i]", distroTokens[i]);
            uint256 tokenDistroLength = oldBooster.distributionByTokenLength(distroTokens[i]);
            address[] memory distros = new address[](tokenDistroLength);
            uint256[] memory shares = new uint256[](tokenDistroLength);
            bool[] memory callQueues = new bool[](tokenDistroLength);
            for (uint256 j = 0; j < tokenDistroLength; j++) {
                (distros[j], shares[j], callQueues[j]) = oldBooster.distributionByTokens(distroTokens[i], j);
            }
            newBooster.updateDistributionByTokens(distroTokens[i], distros, shares, callQueues);
        }

        newBooster.setFactories(oldBooster.rewardFactory(), oldBooster.tokenFactory());
        newBooster.setExtraRewardsDistributor(address(oldBooster.extraRewardsDist()));
        newBooster.setLockRewardContracts(oldBooster.crvLockRewards(), oldBooster.cvxLocker());
        newBooster.setVoteDelegate(oldBooster.voteDelegate());
        newBooster.setEarmarkIncentive(oldBooster.earmarkIncentive());
        newBooster.setFeeManager(oldBooster.feeManager());

        IMinter(oldBooster.cvx()).updateOperator();

        require(IMinter(oldBooster.cvx()).operator() == address(newBooster), "!operator");

        oldBooster.setOwner(boosterOwner);
        voterProxy.setOwner(boosterOwner);

        newBooster.setOwner(boosterOwner);

        emit Migrated(address(newBooster), newBooster.poolLength());
    }

    function callContract(address _contract, bytes calldata _data) external {
        require(msg.sender == boosterOwner, "!auth");
        (bool success, bytes memory returndata) = _contract.call(_data);

        emit CallContract(_contract, _data, success, _data);
    }
}
