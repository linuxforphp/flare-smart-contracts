// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {ExplicitDelegation} from "../lib/ExplicitDelegation.sol";

/**
 * @title ExplicitDelegation mock contract
 * @notice A contract to expose the ExplicitDelegation library for unit testing.
 **/
contract ExplicitDelegationMock {
    using ExplicitDelegation for ExplicitDelegation.DelegationState;

    ExplicitDelegation.DelegationState private _self;

    function addReplaceDelegate(address delegate, uint256 bips) public {
        _self.addReplaceDelegate(delegate, bips);
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
}
