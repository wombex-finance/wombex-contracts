// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";

contract GetData {
    function getData(address[] memory lpTokensAdded, int256[] memory deltas) pure public returns (bytes memory) {
        return abi.encodeWithSelector(IBribeVoter.vote.selector, lpTokensAdded, deltas);
    } 
}