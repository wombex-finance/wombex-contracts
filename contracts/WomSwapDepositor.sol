// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

/**
 * @title   WomSwapDepositor
 * @notice  Swap WOM to wmxWom and stake to BaseRewardPool
 */
contract WomSwapDepositor is Ownable {
    using SafeERC20 for IERC20;

    address public wom;
    address public wmxWom;
    address public pool;
    address public swapRouter;

    event Deposit(address indexed account, address stakeAddress, uint256 amountIn, uint256 amountOut);

    /**
     * @param _wom              WOM Token address
     * @param _wmxWom           wmxWom Token address
     * @param _pool             Pool address
     * @param _swapRouter       Swap router
     */
    constructor(
        address _wom,
        address _wmxWom,
        address _pool,
        address _swapRouter
    ) public {
        wom = _wom;
        wmxWom = _wmxWom;
        pool = _pool;
        swapRouter = _swapRouter;

        IERC20(wom).safeApprove(swapRouter, type(uint256).max);
    }

    /**
     * @notice  Swap WOM tokens into wmxWom and stake to BaseRewardsPool
     * @param _amount        Amount WOM to deposit
     * @param _stakeAddress  Staker to deposit WmxWom
     * @param _minAmountOut  Min wmxWom amount to out from swap
     * @param _deadline      Swap deadline
     */
    function deposit(uint256 _amount, address _stakeAddress, uint256 _minAmountOut, uint256 _deadline) public returns (bool) {
        require(_deadline >= block.timestamp, "deadline");

        IERC20(wom).safeTransferFrom(msg.sender, address(this), _amount);

        uint256 wmxWomAmount = ISwapRouter(swapRouter).swapExactTokensForTokens(getTokensPath(), getPoolsPath(), _amount, _minAmountOut, address(this), _deadline);

        //stake for to
        if (_stakeAddress == address(0)) {
            IERC20(wmxWom).safeTransfer(msg.sender, wmxWomAmount);
        } else {
            IERC20(wmxWom).safeApprove(_stakeAddress, 0);
            IERC20(wmxWom).safeApprove(_stakeAddress, wmxWomAmount);
            IRewards(_stakeAddress).stakeFor(msg.sender, wmxWomAmount);
        }

        emit Deposit(msg.sender, _stakeAddress, _amount, wmxWomAmount);
        return true;
    }

    function quotePotentialSwap(int256 _amountIn) external view returns (uint256 amountOut, uint256 oneOut, uint256 amountOutFee, int256 priceImpact) {
        (amountOut, amountOutFee) = IPool(pool).quotePotentialSwap(wom, wmxWom, _amountIn);
        (oneOut, ) = IPool(pool).quotePotentialSwap(wom, wmxWom, 1 ether);
        priceImpact = getPriceImpact(_amountIn, int256(amountOut), int256(oneOut));
    }

    function getPriceImpact(int256 _amountIn, int256 _amountOut, int256 _oneOut) public pure returns (int256) {
        return ((((_amountOut * 1 ether) / _amountIn) - _oneOut) * 1 ether) / _oneOut * 100;
    }

    function getTokensPath() public view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = wom;
        tokens[1] = wmxWom;
    }

    function getPoolsPath() public view returns (address[] memory pools) {
        pools = new address[](1);
        pools[0] = pool;
    }

    /**
     * @notice  Rescue all tokens but wom from contract
     * @param _tokens       Tokens addresses
     * @param _recipient    Recipient address
     */
    function rescueTokens(address[] memory _tokens, address _recipient) public onlyOwner {
        for (uint256 i; i < _tokens.length; i++) {
            require(_tokens[i] != wom, "!wom");
            IERC20(_tokens[i]).safeTransfer(_recipient, IERC20(_tokens[i]).balanceOf(address(this)));
        }
    }
}
