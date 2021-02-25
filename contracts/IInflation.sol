// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IRewardContract.sol";


interface IInflation {

    /// Allocating new batch of FLR for rewarding users.
    /// Allocation will be bounded for X FLR per hour/day
    /// can only be called by the reward contract.
    function allocateFlrReward() external;

    /// reward contract adress can only be updated by the governance contract
    function updateRewardContract(IRewardContract rewardContract) external;
}
