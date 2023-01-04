// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {WmxMath} from "./WmxMath.sol";
import {IWmxLocker, IWomDepositorWrapper, IWomSwapDepositor} from "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

interface IExtraRewards {
    function getReward(address _account, address _token) external;
}

interface IBasicRewards {
    function getReward(address _account, bool _lockWmx) external;

    function getReward(address _account) external;

    function depositFor(
        uint256 _pid,
        uint256 _amount,
        address _user
    ) external;

    function stakeFor(address, uint256) external;
}

/**
 * @title   ClaimZap
 * @author  ConvexFinance -> AuraFinance -> WombexFinance
 * @notice  Claim zap to bundle various reward claims
 * @dev     Claims from all pools, and stakes wmxWom and WMX if wanted.
 *          v2:
 *           - change exchange to use curve pool
 *           - add getReward(address,token) type
 *           - add option to lock wmx
 *           - add option use all funds in wallet
 */
contract WmxClaimZap {
    using SafeERC20 for IERC20;
    using WmxMath for uint256;

    IERC20 public immutable wom;
    IERC20 public immutable wmx;
    IERC20 public immutable womWmx;
    IWomDepositorWrapper public immutable womDepositor;
    IBasicRewards public immutable wmxWomRewards;
    IExtraRewards public immutable extraRewardsDistributor;
    IWomSwapDepositor public immutable womSwapDepositor;
    IWmxLocker public immutable locker;
    address public immutable owner;

    enum Options {
        ClaimWmxWom, //1
        ClaimLockedWmx, //2
        ClaimLockedWmxStake, //4
        LockWomDeposit, //8
        UseAllWalletFunds, //16
        LockWmx, //32
        LockWmxRewards, //64
        StakeWmxWom, //128
        WomSwapDeposit //256
}

    /**
     * @param _wom                      WOM token
     * @param _wmx                      WMX token
     * @param _wmxWom                   wmxWom token
     * @param _womDepositor             womDepositor
     * @param _wmxWomRewards            wmxWomRewards
     * @param _extraRewardsDistributor  ExtraRewardsDistributor
     * @param _locker                   vlWMX
     */
    constructor(
        IERC20 _wom,
        IERC20 _wmx,
        IERC20 _wmxWom,
        IWomDepositorWrapper _womDepositor,
        IBasicRewards _wmxWomRewards,
        IExtraRewards _extraRewardsDistributor,
        IWomSwapDepositor _womSwapDepositor,
        IWmxLocker _locker,
        address _owner
    ) {
        wom = _wom;
        wmx = _wmx;
        womWmx = _wmxWom;
        womDepositor = _womDepositor;
        wmxWomRewards = _wmxWomRewards;
        extraRewardsDistributor = _extraRewardsDistributor;
        womSwapDepositor = _womSwapDepositor;
        locker = _locker;
        owner = _owner;
        _setApprovals();
    }

    function getName() external pure returns (string memory) {
        return "ClaimZap V3.0";
    }

    /**
     * @notice Approve spending of:
     *          wom     -> womDepositor
     *          wmxWom  -> wmxWomRewards
     *          wmx     -> Locker
     */
    function setApprovals() external {
        require(msg.sender == owner, "!auth");

        _setApprovals();
    }

    function _setApprovals() internal {
        wom.safeApprove(address(womDepositor), 0);
        wom.safeApprove(address(womDepositor), type(uint256).max);

        wom.safeApprove(address(womSwapDepositor), 0);
        wom.safeApprove(address(womSwapDepositor), type(uint256).max);

        womWmx.safeApprove(address(wmxWomRewards), 0);
        womWmx.safeApprove(address(wmxWomRewards), type(uint256).max);

        wmx.safeApprove(address(locker), 0);
        wmx.safeApprove(address(locker), type(uint256).max);
    }

    /**
     * @notice Use bitmask to check if option flag is set
     */
    function _checkOption(uint256 _mask, Options _flag) internal pure returns (bool) {
        return (_mask & (1 << uint256(_flag))) != 0;
    }

    /**
     * @notice Claim all the rewards
     * @param rewardContracts       Array of addresses for LP token rewards
     * @param extraRewardTokens  Array of addresses for extra rewards
     * @param tokenRewardContracts  Array of addresses for token rewards e.g vlWmxExtraRewardDistribution
     * @param tokenRewardPids       Array of token staking ids to use with tokenRewardContracts
     * @param depositWomMaxAmount   The max amount of WOM to deposit if converting to womWmx
     * @param wmxWomMinOutAmount    The min amount out for wom:wmxWom swaps if swapping. Set this to zero if you
     *                              want to use WomDepositor instead of balancer swap
     * @param depositWmxMaxAmount   The max amount of WMX to deposit if locking WMX
     * @param options               Claim options
     */
    function claimRewards(
        address[] calldata rewardContracts,
        address[] calldata extraRewardTokens,
        address[] calldata tokenRewardContracts,
        uint256[] calldata tokenRewardPids,
        uint256 depositWomMaxAmount,
        uint256 wmxWomMinOutAmount,
        uint256 depositWmxMaxAmount,
        uint256 options
    ) external {
        require(tokenRewardContracts.length == tokenRewardPids.length, "!parity");

        uint256 womBalance = wom.balanceOf(msg.sender);
        uint256 wmxBalance = wmx.balanceOf(msg.sender);

        //claim from main curve LP pools
        for (uint256 i = 0; i < rewardContracts.length; i++) {
            IBasicRewards(rewardContracts[i]).getReward(msg.sender, _checkOption(options, Options.LockWmxRewards));
        }
        //claim from extra rewards
        for (uint256 i = 0; i < extraRewardTokens.length; i++) {
            extraRewardsDistributor.getReward(msg.sender, extraRewardTokens[i]);
        }
        //claim from multi reward token contract
        for (uint256 i = 0; i < tokenRewardContracts.length; i++) {
            IBasicRewards(tokenRewardContracts[i]).depositFor(tokenRewardPids[i], 0, msg.sender);
        }

        // claim others/deposit/lock/stake
        _claimExtras(depositWomMaxAmount, wmxWomMinOutAmount, depositWmxMaxAmount, womBalance, wmxBalance, options);
    }

    /**
     * @notice  Claim additional rewards from:
     *          - wmxWomRewards
     *          - wmxLocker
     * @param depositWomMaxAmount see claimRewards
     * @param wmxWomMinOutAmount  see claimRewards
     * @param depositWmxMaxAmount see claimRewards
     * @param removeWomBalance    womBalance to ignore and not redeposit (starting Wom balance)
     * @param removeWmxBalance    wmxBalance to ignore and not redeposit (starting Wmx balance)
     * @param options             see claimRewards
     */
    // prettier-ignore
    function _claimExtras( // solhint-disable-line
        uint256 depositWomMaxAmount,
        uint256 wmxWomMinOutAmount,
        uint256 depositWmxMaxAmount,
        uint256 removeWomBalance,
        uint256 removeWmxBalance,
        uint256 options
    ) internal {
        //claim from wmxWom rewards
        if (_checkOption(options, Options.ClaimWmxWom)) {
            wmxWomRewards.getReward(msg.sender, _checkOption(options, Options.LockWmxRewards));
        }

        //claim from locker
        if (_checkOption(options, Options.ClaimLockedWmx)) {
            locker.getReward(msg.sender, _checkOption(options, Options.ClaimLockedWmxStake));
        }

        //reset remove balances if we want to also stake/lock funds already in our wallet
        if (_checkOption(options, Options.UseAllWalletFunds)) {
            removeWomBalance = 0;
            removeWmxBalance = 0;
        }

        //lock upto given amount of wom and stake
        if (depositWomMaxAmount > 0) {
            uint256 womBalance = wom.balanceOf(msg.sender).sub(removeWomBalance);
            womBalance = WmxMath.min(womBalance, depositWomMaxAmount);

            if (womBalance > 0) {
                //pull wom
                wom.safeTransferFrom(msg.sender, address(this), womBalance);
                //deposit
                if (_checkOption(options, Options.WomSwapDeposit)) {
                    womSwapDepositor.deposit(
                        womBalance,
                        address(0),
                        wmxWomMinOutAmount,
                        type(uint256).max
                    );
                } else {
                    womDepositor.deposit(
                        womBalance,
                        wmxWomMinOutAmount,
                        _checkOption(options, Options.LockWomDeposit),
                        address(0)
                    );
                }

                uint256 wmxWomBalance = womWmx.balanceOf(address(this));
                if (_checkOption(options, Options.StakeWmxWom)) {
                    //stake for msg.sender
                    wmxWomRewards.stakeFor(msg.sender, wmxWomBalance);
                } else {
                    womWmx.safeTransfer(msg.sender, wmxWomBalance);
                }
            }
        }

        //stake up to given amount of wmx
        if (depositWmxMaxAmount > 0 && _checkOption(options, Options.LockWmx)) {
            uint256 wmxBalance = wmx.balanceOf(msg.sender).sub(removeWmxBalance);
            wmxBalance = WmxMath.min(wmxBalance, depositWmxMaxAmount);
            if (wmxBalance > 0) {
                //pull wmx
                wmx.safeTransferFrom(msg.sender, address(this), wmxBalance);
                locker.lock(msg.sender, wmxBalance);
            }
        }
    }
}
