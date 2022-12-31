// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./WomDepositor.sol";

contract WomDepositorV2 is WomDepositor {

    event Migrated(uint256 currentSlot, uint256 checkOldSlot, uint256 customLockAccountsLen, uint256 lockDays, uint256 smartLockPeriod, uint256 lastLockAt);

    WomDepositor public oldDepositor;
    bool public migrated;

    constructor(
        address _wom,
        address _staker,
        address _minter,
        address _booster,
        address _oldDepositor
    ) public WomDepositor(_wom, _staker, _minter, _booster) {
        oldDepositor = WomDepositor(_oldDepositor);
    }

    function _smartLock(uint256 _amount) internal override {
        require(migrated, "!migrated");

        super._smartLock(_amount);
    }

    function migrate(address[] memory _oldCustomLockAccounts, uint256[] memory _oldCustomLockSlotLengths) public onlyOwner {
        require(!migrated, "migrated");
        require(_oldCustomLockAccounts.length == _oldCustomLockSlotLengths.length, "length_mismatch");

        uint256 oldCurrentSlot = oldDepositor.currentSlot();

        for (uint256 i = currentSlot; i < oldCurrentSlot; i++) {
            slotEnds[i] = oldDepositor.slotEnds(i);
            currentSlot++;
        }

        require(oldCurrentSlot == currentSlot, "!current_slot");

        for (uint256 i = 0; i < _oldCustomLockAccounts.length; i++) {
            address account = _oldCustomLockAccounts[i];
            _setCustomLock(account, oldDepositor.customLockDays(account), oldDepositor.customLockMinAmount(account));

            uint256 length = _oldCustomLockSlotLengths[i];
            for (uint256 j = 0; j < length; j++) {
                (uint256 number, uint256 amount) = oldDepositor.customLockSlots(account, j);
                customLockSlots[account].push(SlotInfo(number, amount));
                lockedCustomSlots[number] = oldDepositor.lockedCustomSlots(number);
                releasedCustomSlots[number] = oldDepositor.releasedCustomSlots(number);
            }
        }

        lockDays = oldDepositor.lockDays();
        smartLockPeriod = oldDepositor.smartLockPeriod();
        checkOldSlot = oldDepositor.checkOldSlot();
        lastLockAt = oldDepositor.lastLockAt();
        migrated = true;

        emit Migrated(currentSlot, checkOldSlot, customLockAccounts.length, lockDays, smartLockPeriod, lastLockAt);
    }
}
