// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {PercentageDelegation} from "../lib/PercentageDelegation.sol";
import {DelegationHistory} from "../lib/DelegationHistory.sol";

/**
 * @title PercentageDelegation mock contract
 * @notice A contract to expose the PercentageDelegation library for unit testing.
 **/
contract PercentageDelegationMock {
    using PercentageDelegation for PercentageDelegation.DelegationState;

    PercentageDelegation.DelegationState private _self;

    uint public maxDelegateCount = DelegationHistory.MAX_DELEGATES_BY_PERCENT;

    function addReplaceDelegate(address delegate, uint256 bips) public {
        _self.addReplaceDelegate(delegate, bips);
    }
    
    // for testing multiple delegations in a block
    function addReplaceMultipleDelegates(address[] memory delegates, uint256[] memory bipss) public {
        require (delegates.length == bipss.length);
        for (uint i = 0; i < delegates.length; i++) {
            _self.addReplaceDelegate(delegates[i], bipss[i]);
        }
    }
    
    function getDelegatedTotalAt(uint256 blockNumber) public view returns (uint256 totalBips) {
        return _self.getDelegatedTotalAt(blockNumber);
    }
    
    function getDelegatedTotal() public view returns (uint256 totalBips) {
        return _self.getDelegatedTotal();
    }
    
    function getDelegatedValueAt(address delegate, uint256 blockNumber) public view returns (uint256 bips) {
        return _self.getDelegatedValueAt(delegate, blockNumber);
    }
    
    function getDelegatedValue(address delegate) public view returns (uint256 bips) {
        return _self.getDelegatedValue(delegate);
    }
    
    function getDelegationsAt(uint256 blockNumber) 
    public view returns (address[] memory delegates, uint256[] memory values) {
        return _self.getDelegationsAt(blockNumber);
    }
    
    function getDelegations() public view returns (address[] memory delegates, uint256[] memory values) {
        return _self.getDelegations();
    }
    
    function clear() public {
        _self.clear();
    }
}
