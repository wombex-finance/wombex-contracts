// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/utils/math/SafeMath.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.8/utils/Address.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   PoolDepositor
 * @author  WombexFinance
 * @notice  Allows to deposit underlying tokens and wrap them in lp tokens
 */
contract PoolDepositor {
    using SafeERC20 for IERC20;
    using Address for address;
    using SafeMath for uint256;

    address public booster;
    address public pool;
    address public masterWombat;

    /**
     * @param _booster          Booster
     * @param _pool             Pool
     */
    constructor(address _booster, address _pool, address _masterWombat) {
        booster =  _booster;
        pool =  _pool;
        masterWombat =  _masterWombat;
    }

    function deposit(address _lptoken, uint256 _amount, uint256 _minLiquidity, bool _stake) external {
        address underlying = IAsset(_lptoken).underlyingToken();

        IERC20(underlying).transferFrom(msg.sender, address(this), _amount);
        IERC20(underlying).approve(pool, _amount);

        uint256 balanceBefore = IERC20(_lptoken).balanceOf(address(this));
        IPool(pool).deposit(underlying, _amount, _minLiquidity, address(this), block.timestamp + 1, false);
        uint256 resultLpAmount = IERC20(_lptoken).balanceOf(address(this)).sub(balanceBefore);

        IERC20(_lptoken).approve(booster, resultLpAmount);

        uint256 pid = IMasterWombatV2(masterWombat).getAssetPid(_lptoken);
        IBooster(booster).depositFor(pid, resultLpAmount, _stake, msg.sender);
    }
}
