// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-0.6/access/Ownable.sol";
import "./MockNewBooster.sol";

contract MockBoosterMigrator is Ownable {

    event Migrated(address newBooster, uint256 poolLength);

    function migrate(Booster _oldBooster, address _newOwner) external onlyOwner {
        IStaker voterProxy = IStaker(_oldBooster.voterProxy());

        MockNewBooster newBooster = new MockNewBooster(address(voterProxy), _oldBooster.cvx(), _oldBooster.crv(), _oldBooster.minMintRatio(), _oldBooster.maxMintRatio());

        voterProxy.setOperator(address(newBooster));
        _oldBooster.shutdownSystem();

        uint256 poolLen = _oldBooster.poolLength();
        address[] memory crvRewards = new address[](poolLen);
        uint256[] memory pids = new uint256[](poolLen);

        for (uint256 i = 0; i < poolLen; i++) {
            (, , , address rewards, bool shutdown) = _oldBooster.poolInfo(i);
            if (shutdown) {
                continue;
            }
            pids[i] = i;
            crvRewards[i] = rewards;
        }

        _oldBooster.migrateRewards(crvRewards, pids, address(newBooster));

        for (uint256 i = 0; i < poolLen; i++) {
            (address lptoken, address token, address gauge, address rewards, bool shutdown) = _oldBooster.poolInfo(i);
            if (shutdown) {
                continue;
            }

            newBooster.addCreatedPool(lptoken, gauge, token, rewards);
        }

        _oldBooster.setOwner(_newOwner);
        voterProxy.setOwner(_newOwner);

        emit Migrated(address(newBooster), newBooster.poolLength());
    }

    function returnOwnership(address _newOwner, Booster _booster) external onlyOwner {
        IStaker voterProxy = IStaker(_booster.voterProxy());
        _booster.setOwner(_newOwner);
        voterProxy.setOwner(_newOwner);
    }
}
