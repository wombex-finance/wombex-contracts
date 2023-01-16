// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./vendor/BaseRewardPool4626.sol";

contract BribesRewardPool is BaseRewardPool4626 {
    constructor(
        address stakingToken_,
        address operator_,
        address lptoken_
    ) public BaseRewardPool4626(0, stakingToken_, address(0), operator_, lptoken_) {
        IERC20(asset).safeApprove(operator_, type(uint256).max);
    }

    function stake(uint256 _amount) public returns(bool) {
        require(false, "disabled");
        return true;
    }

    function stakeAll() external returns(bool){
        require(false, "disabled");
        return true;
    }

    function stakeFor(address _for, uint256 _amount) public returns(bool) {
        require(msg.sender == operator, "!operator");
        return BaseRewardPool4626.stakeFor(_for, _amount);
    }

    function withdraw(uint256 amount, bool claim) public returns(bool) {
        require(false, "disabled");
        return true;
    }

    function withdrawAll(bool claim) external{
        require(false, "disabled");
    }

    function withdrawAndUnwrap(uint256 amount, bool claim) public returns(bool){
        require(false, "disabled");
        return true;
    }

    function withdrawAndUnwrapFrom(address _from, uint256 _amount, address _claimRecipient) public returns(bool){
        require(msg.sender == operator, "!operator");
        _totalSupply = _totalSupply.sub(_amount);
        _balances[_from] = _balances[_from].sub(_amount);

        getReward(_claimRecipient, false);

        emit Withdrawn(_from, _amount);

        return true;
    }
}
