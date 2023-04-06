// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./WomDepositorV2.sol";

contract WomDepositorV3 is WomDepositorV2 {

    mapping(address => bool) public mintManagers;

    event SetMintManager(address minter, bool active);
    event Mint(address indexed to, uint256 amount, address indexed minter);

    constructor(
        address _wom,
        address _staker,
        address _minter,
        address _booster,
        address _oldDepositor
    ) public WomDepositorV2(_wom, _staker, _minter, _booster, _oldDepositor) {

    }

    function setMintManager(address _mintManager, bool _active) external onlyOwner {
        mintManagers[_mintManager] = _active;
        emit SetMintManager(_mintManager, _active);
    }

    function mint(address _to, uint256 _amount) external {
        require(mintManagers[msg.sender], "!mintManager");
        ITokenMinter(minter).mint(_to, _amount);
        emit Mint(_to, _amount, msg.sender);
    }
}
