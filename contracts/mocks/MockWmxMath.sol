// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {WmxMath, WmxMath32, WmxMath112, WmxMath224} from "../WmxMath.sol";

// solhint-disable func-name-mixedcase
contract MockWmxMath {
    constructor() {}

    function WmxMath_min(uint256 a, uint256 b) external pure returns (uint256) {
        return WmxMath.min(a, b);
    }

    function WmxMath_add(uint256 a, uint256 b) external pure returns (uint256) {
        return WmxMath.add(a, b);
    }

    function WmxMath_sub(uint256 a, uint256 b) external pure returns (uint256) {
        return WmxMath.sub(a, b);
    }

    function WmxMath_mul(uint256 a, uint256 b) external pure returns (uint256) {
        return WmxMath.mul(a, b);
    }

    function WmxMath_div(uint256 a, uint256 b) external pure returns (uint256) {
        return WmxMath.div(a, b);
    }

    function WmxMath_average(uint256 a, uint256 b) external pure returns (uint256) {
        return WmxMath.average(a, b);
    }

    function WmxMath_to224(uint256 a) external pure returns (uint224) {
        return WmxMath.to224(a);
    }

    function WmxMath_to128(uint256 a) external pure returns (uint128) {
        return WmxMath.to128(a);
    }

    function WmxMath_to112(uint256 a) external pure returns (uint112) {
        return WmxMath.to112(a);
    }

    function WmxMath_to96(uint256 a) external pure returns (uint96) {
        return WmxMath.to96(a);
    }

    function WmxMath_to32(uint256 a) external pure returns (uint32) {
        return WmxMath.to32(a);
    }

    function WmxMath32_sub(uint32 a, uint32 b) external pure returns (uint32) {
        return WmxMath32.sub(a, b);
    }

    function WmxMath112_add(uint112 a, uint112 b) external pure returns (uint112) {
        return WmxMath112.add(a, b);
    }

    function WmxMath112_sub(uint112 a, uint112 b) external pure returns (uint112) {
        return WmxMath112.sub(a, b);
    }

    function WmxMath224_add(uint224 a, uint224 b) external pure returns (uint224) {
        return WmxMath224.add(a, b);
    }
}
