// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IValidatorRewardManager.sol";
import "../../genesis/interface/IIStateConnector.sol";

interface IIValidatorRewardManager is IValidatorRewardManager {

    function activate() external;
    function deactivate() external;

    
    function setStateConnector(IIStateConnector _stateConnector) external;
}
