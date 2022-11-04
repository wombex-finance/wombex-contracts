// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./WomDepositor.sol";

contract WomDepositorV2 is WomDepositor {
    using SafeMath for uint256;

    WomDepositor public oldDepositor;
    address[] public oldCustomLockAccounts;
    bool public migrated;

    constructor(
        address _wom,
        address _staker,
        address _minter,
        address _booster,
        address _oldDepositor,
        address[] memory _oldCustomLockAccounts
    ) public WomDepositor(_wom, _staker, _minter, _booster) {
        oldDepositor = WomDepositor(_oldDepositor);
        oldCustomLockAccounts = _oldCustomLockAccounts;
    }

    function _smartLock(uint256 _amount) internal override {
        require(migrated, "!migrated");

        super._smartLock(_amount);
    }

    function migrate() public {
        require(!migrated, "migrated");

        uint256 oldCurrentSlot = oldDepositor.currentSlot();

        for (uint256 i = currentSlot; i < oldCurrentSlot; i++) {
            slotEnds[i] = oldDepositor.slotEnds(i);
            currentSlot++;
        }

        for (uint256 i = 0; i < oldCustomLockAccounts.length; i++) {
            address account = oldCustomLockAccounts[i];
            customLockDays[account] = oldDepositor.customLockDays(account);
            customLockMinAmount[account] = oldDepositor.customLockMinAmount(account);

            uint256 length = oldDepositor.getCustomLockSlotsLength(account);
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
    }

    function getOldCustomLockAccounts() external view returns (address[] memory) {
        return oldCustomLockAccounts;
    }
}
