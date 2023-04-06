// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../VoterProxy.sol";

contract VoterProxyV2Mock is VoterProxy {
    function v2Method() external view returns (string memory)  {
        return "test";
    }
}
