// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../implementations/Governed.sol";
import "../../interfaces/IInflation.sol";
import "../../interfaces/IRewardManager.sol";


contract InflationMock is IInflation, Governed {
    constructor(address _governance) Governed(_governance) {}

    /// Allocating new batch of FLR for rewarding users.
    /// Allocation will be bounded for X FLR per hour/day
    /// can only be called by the reward contract.
    function withdrawRewardFunds() external override returns (uint256 nextWithdrawTimestamp) {}

    /// reward contract address can only be updated by the governance contract
    function setRewardContract(IRewardContract rewardContract) external override {}
}