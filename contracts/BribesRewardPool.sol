// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./vendor/BaseRewardPool4626.sol";

contract BribesRewardPool is BaseRewardPool4626 {
    bool callOperatorOnGetReward;

    event UpdateBribesConfig(bool callOperatorOnGetReward);
    event UpdateRatioConfig(uint256 duration, uint256 maxRewardRatio);

    constructor(
        address stakingToken_,
        address operator_,
        address lptoken_,
        bool _callOperatorOnGetReward
    ) public BaseRewardPool4626(0, stakingToken_, address(0), operator_, lptoken_) {
        callOperatorOnGetReward = _callOperatorOnGetReward;
    }

    function updateBribesConfig(bool _callOperatorOnGetReward) external {
        require(msg.sender == operator, "!authorized");
        callOperatorOnGetReward = _callOperatorOnGetReward;

        emit UpdateBribesConfig(callOperatorOnGetReward);
    }

    function updateRatioConfig(uint256 _duration, uint256 _maxRewardRatio) external {
        require(msg.sender == operator, "!authorized");
        DURATION = _duration;
        NEW_REWARD_RATIO = _maxRewardRatio;

        emit UpdateRatioConfig(_duration, _maxRewardRatio);
    }

    function stake(uint256 _amount) public override returns(bool) {
        require(false, "disabled");
        return true;
    }

    function stakeFor(address _for, uint256 _amount) public override returns(bool) {
        require(msg.sender == operator, "!operator");
        return BaseRewardPool.stakeFor(_for, _amount);
    }

    function getReward(address _account, bool _lockCvx) public override returns(bool){
        if (callOperatorOnGetReward) {
            IDeposit(operator).rewardClaimed(0, _account, 0, false);
        }
        return BaseRewardPool.getReward(_account, _lockCvx);
    }

    function withdraw(uint256 amount, bool claim) public override returns(bool) {
        require(false, "disabled");
        return true;
    }

    function withdrawAndUnwrap(uint256 amount, bool claim) public override returns(bool) {
        require(false, "disabled");
        return true;
    }

    function withdrawAndUnwrapFrom(address _from, uint256 _amount, address _claimRecipient) public returns(bool) {
        require(msg.sender == operator, "!operator");
        _totalSupply = _totalSupply.sub(_amount);
        _balances[_from] = _balances[_from].sub(_amount);

        getReward(_claimRecipient, false);

        emit Withdrawn(_from, _amount);

        return true;
    }
}
