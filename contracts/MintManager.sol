// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Interfaces.sol";
import "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title   MintManager
 * @author  WombexFinance
 */
contract MintManager is Ownable {
    address public voterProxy;
    address public booster;

    mapping(address => uint256) public totalMinted;
    mapping(address => uint256) public mintLimit;
    address[] public minters;

    event SetMintLimit(address indexed minter, uint256 limit);
    event Mint(address indexed minter, address indexed receiver, uint256 amount);

    constructor(address _voterProxy) {
        voterProxy = _voterProxy;
        booster = IStaker(_voterProxy).operator();
    }

    function updateBooster() external {
        booster = IStaker(voterProxy).operator();
    }

    function _checkMintLimit(uint256 _amount) internal {
        totalMinted[msg.sender] += _amount;
        require(mintLimit[msg.sender] >= totalMinted[msg.sender], "limit");
    }

    function setMintLimit(address _minter, uint256 _limit) external onlyOwner {
        if (mintLimit[_minter] == 0) {
            minters.push(_minter);
        }
        mintLimit[_minter] = _limit;
        emit SetMintLimit(_minter, _limit);
    }

    function mint(address _receiver, uint256 _amount) external {
        _checkMintLimit(_amount);
        IBooster(booster).minterMint(_receiver, _amount);
        emit Mint(msg.sender, _receiver, _amount);
    }

    function getMinters() external returns(address[] memory) {
        return minters;
    }
}
