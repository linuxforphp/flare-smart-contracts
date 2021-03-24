// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {Delegation} from "../../lib/Delegation.sol";

/**
 * @title Delegation mock contract
 * @notice A contract to expose the Delegation library for unit testing.
 **/
contract DelegationMock {
    using Delegation for Delegation.DelegationState;

    Delegation.DelegationState private _self;

    uint8 public MAX_DELEGATES_BY_PERCENT = Delegation.MAX_DELEGATES_BY_PERCENT;

    function addReplaceDelegateByPercent(
        address delegate, 
        uint16 bips) public {
        _self.addReplaceDelegateByPercent(delegate, bips);
    }

    function addReplaceDelegateByAmount(
        address delegate, 
        uint256 amount) public {
        _self.addReplaceDelegateByAmount(delegate, amount);
    }

    function getDelegateTotal() public view returns (uint256 totalAmount) {
        return _self.getDelegateTotal();
    }

    function getDelegationMode() public view returns(Delegation.DelegationMode delegationMode) {
        return _self.getDelegationMode();
    }

    function tryFindDelegate(
        address delegate) public view returns(bool found, uint256 amountOrBips) {
        return _self.tryFindDelegate(delegate);
    }

    function tryRemoveDelegate(
        address delegate) public returns(bool found) {
        return _self.tryRemoveDelegate(delegate);
    }

    function clear() public {
        _self.clear();
    }
}