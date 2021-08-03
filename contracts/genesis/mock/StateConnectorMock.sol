// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/implementation/StateConnector.sol";

contract StateConnectorMock is StateConnector {

    function addNewClaimPeriodsMined(address miner) external {
        uint256 rewardSchedule = getRewardPeriod();
        claimPeriodsMined[miner][rewardSchedule] = claimPeriodsMined[miner][rewardSchedule] + 1;
        totalClaimPeriodsMined[rewardSchedule] = totalClaimPeriodsMined[rewardSchedule] + 1;
    }
}
