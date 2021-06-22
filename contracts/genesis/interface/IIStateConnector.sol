// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IIStateConnector {

    function getRewardPeriod() external view returns (uint256 rewardSchedule);
    function getTotalClaimPeriodsMined(uint256 rewardSchedule) external view returns (uint64 numMined);
    function getClaimPeriodsMined(address miner, uint256 rewardSchedule) external view returns (uint64 numMined);
}
