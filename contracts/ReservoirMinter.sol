// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import {WmxMath} from "./WmxMath.sol";

contract ReservoirMinter is Ownable {
    using SafeERC20 for IERC20;
    using WmxMath for uint256;

    uint256 public constant EMISSIONS_MAX_SUPPLY = 5e25; // 50m
    uint256 public constant INIT_MINT_AMOUNT = 5e25; // 50m
    uint256 public constant totalCliffs = 500;
    uint256 public immutable reductionPerCliff;

    IERC20 public token;
    uint256 public totalSupply;
    mapping(address => bool) public minters;

    event SetMinter(address minter, bool active);
    event Mint(address to, uint256 amount);

    constructor(address _token, uint256 _initSupply) public Ownable() {
        token = IERC20(_token);
        totalSupply = _initSupply;
        reductionPerCliff = EMISSIONS_MAX_SUPPLY.div(totalCliffs);
    }

    function setMinter(address _minter, bool _active) external onlyOwner {
        minters[_minter] = _active;
        emit SetMinter(_minter, _active);
    }

    function rescueTokens(address _token, address _to, uint256 _amount) external onlyOwner {
        IERC20(_token).safeTransfer(_to, _amount);
    }

    function mint(
        address _to,
        uint256 _amount
    ) external {
        if (!minters[msg.sender]) {
            return;
        }

        // e.g. emissionsMinted = 6e25 - 5e25 - 0 = 1e25;
        uint256 emissionsMinted = totalSupply - INIT_MINT_AMOUNT;
        // e.g. reductionPerCliff = 5e25 / 500 = 1e23
        // e.g. cliff = 1e25 / 1e23 = 100
        uint256 cliff = emissionsMinted.div(reductionPerCliff);

        // e.g. 100 < 500
        if (cliff < totalCliffs) {
            // e.g. (new) reduction = (500 - 100) * 2.5 + 700 = 1700;
            // e.g. (new) reduction = (500 - 250) * 2.5 + 700 = 1325;
            // e.g. (new) reduction = (500 - 400) * 2.5 + 700 = 950;
            uint256 reduction = totalCliffs.sub(cliff).mul(5).div(2).add(2);
            // e.g. (new) amount = 1e19 * 1700 / 500 =  34e18;
            // e.g. (new) amount = 1e19 * 1325 / 500 =  26.5e18;
            // e.g. (new) amount = 1e19 * 950 / 500  =  19e17;
            uint256 amount = _amount.mul(reduction).div(totalCliffs);
            // e.g. amtTillMax = 5e25 - 1e25 = 4e25
            uint256 amtTillMax = EMISSIONS_MAX_SUPPLY.sub(emissionsMinted);
            if (amount > amtTillMax) {
                amount = amtTillMax;
            }
            token.safeTransfer(_to, amount);
            totalSupply += amount;
            emit Mint(_to, amount);
        }
    }

    function getFactAmounMint(uint256 _amount) external view returns(uint256 amount) {
        uint256 emissionsMinted = totalSupply - INIT_MINT_AMOUNT;
        uint256 cliff = emissionsMinted.div(reductionPerCliff);
        if (cliff < totalCliffs) {
            uint256 reduction = totalCliffs.sub(cliff).mul(5).div(2).add(2);
            amount = _amount.mul(reduction).div(totalCliffs);
            uint256 amtTillMax = EMISSIONS_MAX_SUPPLY.sub(emissionsMinted);
            if (amount > amtTillMax) {
                amount = amtTillMax;
            }
        }
    }
}
