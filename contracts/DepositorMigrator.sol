// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./WomDepositorV2.sol";

contract DepositorMigrator is Ownable {

    event Migrated(address newDepositor);
    event CallContract(address indexed contractAddress, bytes callData, bool success, bytes returnData);

    WomDepositor public oldWomDepositor;
    address[] public oldCustomLockAccounts;
    IStaker public voterProxy;
    address public depositorOwner;

    constructor(WomDepositor _oldWomDepositor, address[] memory _oldCustomLockAccounts) public {
        oldWomDepositor = _oldWomDepositor;
        oldCustomLockAccounts = _oldCustomLockAccounts;
        depositorOwner = _oldWomDepositor.owner();
        voterProxy = IStaker(_oldWomDepositor.staker());
    }

    function migrate() external onlyOwner {
        address booster = voterProxy.operator();

        WomDepositorV2 newDepositor = new WomDepositorV2(
            oldWomDepositor.wom(),
            address(voterProxy),
            oldWomDepositor.minter(),
            booster,
            address(oldWomDepositor),
            oldCustomLockAccounts
        );
        newDepositor.setLockConfig(oldWomDepositor.lockDays(), oldWomDepositor.smartLockPeriod());

        voterProxy.setDepositor(address(newDepositor));

        oldWomDepositor.updateMinterOperator();

        oldWomDepositor.transferOwnership(depositorOwner);
        newDepositor.transferOwnership(depositorOwner);
        voterProxy.setOwner(depositorOwner);

        if (IBooster(booster).owner() == address(this)) {
            IBooster(booster).setOwner(depositorOwner);
        }
        emit Migrated(address(newDepositor));
    }

    function callContract(address _contract, bytes calldata _data) external {
        require(msg.sender == depositorOwner, "!auth");
        (bool success, bytes memory returndata) = _contract.call(_data);

        emit CallContract(_contract, _data, success, _data);
    }
}
