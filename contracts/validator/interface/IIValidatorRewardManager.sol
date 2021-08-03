// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IValidatorRewardManager.sol";
import "../../genesis/implementation/StateConnector.sol";

interface IIValidatorRewardManager is IValidatorRewardManager {
    
    event DailyAuthorizedInflationSet(uint256 authorizedAmountWei);
    event InflationReceived(uint256 amountReceivedWei);

    function activate() external;
    function deactivate() external;

    
    function setStateConnector(StateConnector _stateConnector) external;
}
