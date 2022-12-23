// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./WmxRewardPool.sol";

contract WmxRewardPoolV2 is WmxRewardPool {
    using WmxMath for uint256;

    uint256 public maxCap;

    constructor(
        address _stakingToken,
        address _rewardToken,
        address _rewardManager,
        address _wmxLocker,
        address _penaltyForwarder,
        uint256 _startDelay,
        uint256 _duration,
        uint256 _maxCap
    ) WmxRewardPool(_stakingToken, _rewardToken, _rewardManager, _wmxLocker, _penaltyForwarder, _startDelay) public {
        duration = _duration;
        maxCap = _maxCap;
    }

    function updateOperatorData(address operator_, uint256 pid_) external {
        require(msg.sender == operator, "!authorized");
        operator = operator_;

        emit UpdateOperatorData(msg.sender, operator_, pid_);
    }

    function _stakeCheck(uint256 _amount) internal override {
        require(msg.sender == operator, "!authorized");
        require(_totalSupply.add(_amount) <= maxCap, "maxCap");
    }
}
