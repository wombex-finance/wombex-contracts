// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./BaseRewardPool4626.sol";

/**
 * @title   BaseRewardPoolLocked
 */
contract BaseRewardPoolLocked is BaseRewardPool4626 {
    uint256 public unlockAt;
    address public lockManager;
    bool public setLockFinished;

    mapping(address => uint256) public lockedBalance;

    event SetLock(address indexed account, uint256 amount, address indexed lockManager);
    event SetLockFinished(address indexed lockManager);

    constructor(
        uint256 pid_,
        address stakingToken_,
        address rewardToken_,
        address operator_,
        address lptoken_,
        address lockManager_,
        uint256 unlockAt_
    ) public BaseRewardPool4626(pid_, stakingToken_, rewardToken_, operator_, lptoken_) {
        require(lockManager_ != address(0), "!zero");
        lockManager = lockManager_;
        unlockAt = unlockAt_;
    }

    function setLock(address[] calldata _accounts, uint256[] calldata _amounts, bool _finish) external {
        require(!setLockFinished, "finished");
        require(msg.sender == lockManager, "!authorized");
        uint256 len = _accounts.length;
        require(len == _amounts.length, "!len");

        for (uint256 i = 0; i < len; i++) {
            lockedBalance[_accounts[i]] = _amounts[i];
            emit SetLock(_accounts[i], _amounts[i], lockManager);
        }

        if (_finish) {
            emit SetLockFinished(lockManager);
            setLockFinished = true;
        }
    }

    function withdraw(uint256 amount, bool claim) public override returns (bool result) {
        result = super.withdraw(amount, claim);
        _checkLockedBalance(msg.sender);
        return result;
    }

    function _withdrawAndUnwrapTo(uint256 amount, address from, address receiver) internal override returns (bool result) {
        require(from != address(0), "!zero");
        result = super._withdrawAndUnwrapTo(amount, from, receiver);
        _checkLockedBalance(from);
        return result;
    }

    function _checkLockedBalance(address _account) internal {
        require(block.timestamp > unlockAt || _balances[_account] >= lockedBalance[_account], "locked");
    }
}