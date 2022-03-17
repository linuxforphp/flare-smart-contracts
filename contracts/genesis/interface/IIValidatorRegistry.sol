// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;


interface IIValidatorRegistry {

    function registerNodeIdAsDataProvider(bytes20 _nodeId) external;
    function getNodeIdForDataProvider(address _dataProvider) external view returns (bytes20 _nodeId);
    function getDataProviderForNodeId(bytes20 _nodeId) external view returns (address _dataProvider);
}
