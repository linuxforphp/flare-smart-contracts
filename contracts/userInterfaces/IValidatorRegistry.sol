// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../utils/interface/IUpdateValidators.sol";


interface IValidatorRegistry is IUpdateValidators {

    function setValidatorNodeID(bytes20 _nodeId) external;
    function getActiveNodeID(address _dataProvider) external view returns (bytes20 _nodeId);
    function getPendingNodeID(address _dataProvider) external view returns (bytes20 _nodeId);
    function getActiveValidator(bytes20 _nodeId) external view returns (address _dataProvider);
    function getPendingValidator(bytes20 _nodeId) external view returns (address _dataProvider);
}
