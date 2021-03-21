// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IRewardManager.sol";


interface IInflation {

    event WithDrawRewardFunds(uint256 timeStamp, uint256 amount);

    /// Allocating new batch of FLR for rewarding users.
    /// Allocation will be bounded for X FLR per hour/day
    /// can only be called by the reward contract.
    function withdrawRewardFunds() external returns (uint256 nextWithdrawTimestamp);

    /// reward contract address can only be updated by the governance contract
    function setRewardContract(IRewardContract rewardContract) external;
}
