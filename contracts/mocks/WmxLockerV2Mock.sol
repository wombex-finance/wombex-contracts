// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../WmxLocker.sol";

contract WmxLockerV2Mock is WmxLocker {
    function v2Method() external view returns (string memory)  {
        return "test 2";
    }
}
