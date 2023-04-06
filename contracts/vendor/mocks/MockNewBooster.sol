// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../Booster.sol";

contract MockNewBooster is Booster {
    constructor(
        address _voterProxy,
        address _reservoir,
        address _cvx,
        address _crv,
        address _weth,
        uint256 _minMintRatio,
        uint256 _maxMintRatio
    ) public Booster(_voterProxy, _reservoir, _cvx, _crv, _weth, _minMintRatio, _maxMintRatio) {
    }

    function newMethod() public view returns (string memory) {
        return "test";
    }
}
