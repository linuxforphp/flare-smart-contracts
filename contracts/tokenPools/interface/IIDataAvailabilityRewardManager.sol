// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IDataAvailabilityRewardManager.sol";
import "../../genesis/implementation/StateConnector.sol";

interface IIDataAvailabilityRewardManager is IDataAvailabilityRewardManager {

    event DailyAuthorizedInflationSet(uint256 authorizedAmountWei);
    event InflationReceived(uint256 amountReceivedWei);

    function activate() external;
    function deactivate() external;
    function setInflation(address _inflation) external;
}
