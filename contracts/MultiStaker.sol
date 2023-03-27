// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";

contract MultiStaker is Ownable {
    using SafeERC20 for IERC20;

    constructor() public Ownable() {
    }

    function depositFor(IBooster booster, uint256 bPid, address[] calldata accounts, uint256[] calldata amounts, uint256 totalAmount) external {
        IBooster.PoolInfo memory pInfo = booster.poolInfo(bPid);
        IERC20 lpToken = IERC20(pInfo.lptoken);

        uint256 sum = 0;
        for (uint256 i; i < amounts.length; i++) {
            sum += amounts[i];
        }
        require(sum == totalAmount, "!sum");

        lpToken.safeTransferFrom(msg.sender, address(this), sum);
        lpToken.approve(address(booster), sum);

        for (uint256 i; i < amounts.length; i++) {
            booster.depositFor(bPid, amounts[i], true, accounts[i]);
        }
    }

    function releaseToken(IERC20 token, address recipient) external onlyOwner {
        token.transfer(recipient, token.balanceOf(address(this)));
    }
}
