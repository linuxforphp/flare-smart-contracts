// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/implementation/StateConnector.sol";

contract StateConnectorMock is StateConnector {

    function addNewDataAvailabilityPeriodsMined(address miner) external {
        uint256 rewardSchedule = getRewardPeriod();
        dataAvailabilityPeriodsMined[miner][rewardSchedule] = dataAvailabilityPeriodsMined[miner][rewardSchedule] + 1;
        totalDataAvailabilityPeriodsMined[rewardSchedule] = totalDataAvailabilityPeriodsMined[rewardSchedule] + 1;
    }
}
