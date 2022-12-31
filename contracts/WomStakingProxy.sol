// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Address } from "@openzeppelin/contracts-0.8/utils/Address.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IWmxLocker, IWomDepositor, IWomSwapDepositor, IPool } from "./Interfaces.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title   WomStakingProxy
 * @author  adapted from ConvexFinance
 * @notice  Receives WOM from the Booster as overall reward, then distributes to vlWMX holders. Also
 *          acts as a depositor proxy to support deposit/withdrawals from the WMX staking contract.
 * @dev     From WMX:
 *           - receive tokens to stake
 *           - get current staked balance
 *           - withdraw staked tokens
 *           - send rewards back to owner(wmx locker)
 */
contract WomStakingProxy is Ownable {
    using SafeERC20 for IERC20;
    using Address for address;

    //tokens
    address public immutable wom;
    address public immutable wmx;
    address public immutable wmxWom;

    address public womDepositor;
    address public womSwapDepositor;
    address public womSwapDepositorPool;
    address public rewards;

    event RewardsSwapped(address indexed swapContract, bool indexed swapDepositor, uint256 amountIn, uint256 amountOut);
    event RewardsDistributed(address indexed token, uint256 amount);

    /* ========== CONSTRUCTOR ========== */

    /**
     * @param _rewards              vlWMX
     * @param _wom                  WOM token
     * @param _wmx                  WMX token
     * @param _wmxWom               wmxWOM token
     * @param _womDepositor         Wrapper that locks WOM to veWom
     * @param _womSwapDepositor     Wrapper that swap WOM to wmxWom
     */
    constructor(
        address _wom,
        address _wmx,
        address _wmxWom,
        address _womDepositor,
        address _womSwapDepositor,
        address _rewards
    ) {
        wom = _wom;
        wmx = _wmx;
        wmxWom = _wmxWom;
        womDepositor = _womDepositor;
        womSwapDepositor = _womSwapDepositor;
        womSwapDepositorPool = IWomSwapDepositor(_womSwapDepositor).pool();
        rewards = _rewards;
    }

    /**
     * @notice Set WomDepositor
     * @param   _womDepositor WomDepositor address
     * @param   _womSwapDepositor WomSwapDepositor address
     * @param   _rewards Rewards address
     */
    function setConfig(address _womDepositor, address _womSwapDepositor, address _rewards) external onlyOwner {
        womDepositor = _womDepositor;
        womSwapDepositor = _womSwapDepositor;
        womSwapDepositorPool = IWomSwapDepositor(_womSwapDepositor).pool();
        rewards = _rewards;
    }

    /**
     * @notice  Approve womDepositor to transfer contract WOM
     *          and rewards to transfer wmxWom
     */
    function setApprovals() external {
        IERC20(wom).safeApprove(womDepositor, 0);
        IERC20(wom).safeApprove(womDepositor, type(uint256).max);

        IERC20(wom).safeApprove(womSwapDepositor, 0);
        IERC20(wom).safeApprove(womSwapDepositor, type(uint256).max);

        IERC20(wmxWom).safeApprove(rewards, 0);
        IERC20(wmxWom).safeApprove(rewards, type(uint256).max);
    }

    /**
     * @notice Transfer stuck ERC20 tokens to `_to`
     */
    function rescueToken(address _token, address _to) external onlyOwner {
        require(_token != wom && _token != wmx && _token != wmxWom, "not allowed");

        uint256 bal = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(_to, bal);
    }

    /**
     * @dev Collects wmxWom rewards from wmxRewardPool, converts any WOM deposited directly from
     *      the booster, and then applies the rewards to the wmxLocker, rewarding the caller in the process.
     */
    function queueNewRewards(address, uint256 _amount) external {
        if (_amount > 0) {
            IERC20(wom).safeTransferFrom(msg.sender, address(this), _amount);
        }

        //convert wom to wmxWom
        uint256 womBal = IERC20(wom).balanceOf(address(this));
        if (womBal > 0) {
            uint256 amountOut;
            if (womSwapDepositorPool != address(0)) {
                (amountOut, ) = IPool(womSwapDepositorPool).quotePotentialSwap(wom, wmxWom, int256(womBal));
            }
            if (amountOut > womBal) {
                IWomSwapDepositor(womSwapDepositor).deposit(womBal, address(0), amountOut, block.timestamp + 1);
                emit RewardsSwapped(womSwapDepositor, true, womBal, amountOut);
            } else  {
                IWomDepositor(womDepositor).deposit(womBal, address(0));
                emit RewardsSwapped(womDepositor, false, womBal, womBal);
            }
        }

        //distribute wmxWom
        uint256 wmxWomBal = IERC20(wmxWom).balanceOf(address(this));
        if (wmxWomBal > 0) {
            //update rewards
            IWmxLocker(rewards).queueNewRewards(wmxWom, wmxWomBal);
            emit RewardsDistributed(wmxWom, wmxWomBal);
        }
    }
}
