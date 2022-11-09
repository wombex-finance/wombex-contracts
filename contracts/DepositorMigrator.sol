// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./WomDepositorV2.sol";

contract DepositorMigrator is Ownable {

    event Migrated(address newDepositor);
    event CallContract(address indexed contractAddress, bytes callData, bool success, bytes returnData);

    WomDepositor public oldWomDepositor;
    address[] public oldCustomLockAccounts;
    uint256[] public oldCustomLockSlotLengths;
    IStaker public voterProxy;
    address public depositorOwner;

    constructor(WomDepositor _oldWomDepositor, address[] memory _oldCustomLockAccounts, uint256[] memory _oldCustomLockSlotLengths) public {
        oldWomDepositor = _oldWomDepositor;
        oldCustomLockAccounts = _oldCustomLockAccounts;
        oldCustomLockSlotLengths = _oldCustomLockSlotLengths;
        depositorOwner = _oldWomDepositor.owner();
        voterProxy = IStaker(_oldWomDepositor.staker());
    }

    function migrate() external onlyOwner {
        address booster = voterProxy.operator();

        address wom = oldWomDepositor.wom();
        if (IERC20(wom).balanceOf(address(oldWomDepositor)) > 0) {
            uint256 lockPeriod = oldWomDepositor.smartLockPeriod();
            oldWomDepositor.setLockConfig(oldWomDepositor.lockDays(), 0);
            oldWomDepositor.deposit(0, address(0));
            oldWomDepositor.setLockConfig(oldWomDepositor.lockDays(), lockPeriod);
        }

        WomDepositorV2 newDepositor = new WomDepositorV2(
            wom,
            address(voterProxy),
            oldWomDepositor.minter(),
            booster,
            address(oldWomDepositor)
        );

        voterProxy.setDepositor(address(newDepositor));
        oldWomDepositor.updateMinterOperator();

        newDepositor.migrate(oldCustomLockAccounts, oldCustomLockSlotLengths);

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
