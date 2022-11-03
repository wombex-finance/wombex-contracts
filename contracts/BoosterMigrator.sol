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
    address public boosterOwner;
    address public weth;

    constructor(Booster _oldBooster, address _weth) public {
        oldBooster = _oldBooster;
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

        IStaker voterProxy = IStaker(oldBooster.voterProxy());

        Booster newBooster = new Booster(address(voterProxy), oldBooster.cvx(), oldBooster.crv(), weth, 2000, 15000);

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
        pids[poolLen] = 0;

        oldBooster.migrateRewards(crvRewards, pids, address(newBooster));

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

        RewardFactory rf = new RewardFactory(address(newBooster), oldBooster.crv());
        TokenFactory tf = new TokenFactory(
            address(newBooster),
            TokenFactory(oldBooster.tokenFactory()).namePostfix(),
            TokenFactory(oldBooster.tokenFactory()).symbolPrefix()
        );

        newBooster.setFactories(address(rf), address(tf));
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

    function callContract(address _contract, bytes calldata _data) external {
        require(msg.sender == boosterOwner, "!auth");
        (bool success, bytes memory returndata) = _contract.call(_data);

        emit CallContract(_contract, _data, success, _data);
    }
}
