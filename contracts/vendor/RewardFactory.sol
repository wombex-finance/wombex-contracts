// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./interfaces/Interfaces.sol";
import "./BaseRewardPool4626.sol";
import "@openzeppelin/contracts-0.6/math/SafeMath.sol";
import "@openzeppelin/contracts-0.6/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-0.6/utils/Address.sol";
import "@openzeppelin/contracts-0.6/token/ERC20/SafeERC20.sol";


/**
 * @title   RewardFactory
 * @author  ConvexFinance -> WombexFinance
 * @notice  Used to deploy reward pools when a new pool is added to the Booster
 *          contract. This contract deploys BaseRewardPool that handles CRV rewards for guages
 */
contract RewardFactory {
    using Address for address;

    address public immutable operator;
    address public immutable crv;

    event RewardPoolCreated(address rewardPool, uint256 _pid, address depositToken);

    /**
     * @param _operator   Contract operator is Booster
     * @param _crv        CRV/WOM token address
     */
    constructor(address _operator, address _crv) public {
        operator = _operator;
        crv = _crv;
    }

    /**
     * @notice Create a Managed Reward Pool to handle distribution of all crv/wom mined in a pool
     */
    function CreateCrvRewards(uint256 _pid, address _depositToken, address _lptoken) external returns (address) {
        require(msg.sender == operator, "!auth");

        //operator = booster(deposit) contract so that new crv/wom can be added and distributed

        BaseRewardPool4626 rewardPool = new BaseRewardPool4626(_pid,_depositToken,crv,operator, address(this), _lptoken);

        emit RewardPoolCreated(address(rewardPool), _pid, _depositToken);
        return address(rewardPool);
    }
}
