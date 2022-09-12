// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import {IWmxLocker} from "../Interfaces.sol";

contract MockWmxLocker {
    using SafeERC20 for IERC20;

    IERC20 public immutable wmx;
    IWmxLocker public immutable locker;

    constructor(address _wmx, address _locker) {
        wmx = IERC20(_wmx);
        locker = IWmxLocker(_locker);
    }

    function lock(uint256 _amount) external {
        wmx.safeTransferFrom(msg.sender, address(this), _amount);
        wmx.safeIncreaseAllowance(address(locker), _amount);
        locker.lock(address(this), _amount);
    }

    function lockFor(address _for, uint256 _amount) external {
        wmx.safeTransferFrom(msg.sender, address(this), _amount);
        wmx.safeIncreaseAllowance(address(locker), _amount);
        locker.lock(_for, _amount);
    }
}
