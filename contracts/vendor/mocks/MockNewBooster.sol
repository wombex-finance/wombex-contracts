// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../Booster.sol";

contract MockNewBooster is Booster {
    constructor(
        address _voterProxy,
        address _cvx,
        address _crv,
        uint256 _minMintRatio,
        uint256 _maxMintRatio
    ) public Booster(_voterProxy, _cvx, _crv, _minMintRatio, _maxMintRatio) {
    }

    function newMethod() public view returns (string memory) {
        return "test";
    }
}
