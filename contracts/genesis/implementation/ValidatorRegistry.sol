// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIValidatorRegistry.sol";
import "../../userInterfaces/IPriceSubmitter.sol";


contract ValidatorRegistry is IIValidatorRegistry {

    address public constant PRICE_SUBMITTER = address(0x1000000000000000000000000000000000000003);

    mapping(address => bytes20) internal dataProviderToNodeId;

    mapping(bytes20 => address) internal nodeIdToDataProvider;

    function registerNodeIdAsDataProvider(bytes20 _nodeId) external override {
        require(nodeIdToDataProvider[_nodeId] == address(0), "node id already in use");
        require(IPriceSubmitter(PRICE_SUBMITTER).voterWhitelistBitmap(msg.sender) > 0, "not whitelisted");
        nodeIdToDataProvider[_nodeId] = msg.sender;
        dataProviderToNodeId[msg.sender] = _nodeId;
    }

    function getNodeIdForDataProvider(address _dataProvider) external view override returns (bytes20 _nodeId) {
        return dataProviderToNodeId[_dataProvider];
    }

    function getDataProviderForNodeId(bytes20 _nodeId) external view override returns (address _dataProvider) {
        return nodeIdToDataProvider[_nodeId];
    }
}
