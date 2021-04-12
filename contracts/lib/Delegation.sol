// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {EnumerableAddressToUintMap} from "./EnumerableAddressToUintMap.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "./SafePct.sol";

/**
 * @title Delegation library
 * @notice A library to manage a group of delegates for allocating voting power by a delegator.
 **/
library Delegation {
    using EnumerableAddressToUintMap for EnumerableAddressToUintMap.AddressToUintMap;
    using SafeMath for uint256;
    using SafePct for uint256;

    enum DelegationMode { 
        NOTSET, 
        PERCENTAGE, 
        AMOUNT
    }

    uint8 public constant MAX_DELEGATES_BY_PERCENT = 5;
    uint16 public constant MAX_BIPS = 10000;
    string private constant MAX_DELEGATES_MSG = "Max delegates exceeded";
    string private constant MAX_BIPS_MSG = "Max delegation bips exceeded";
    
    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of delegates (a Delegation) for a delegator.
     */
    struct DelegationState {
        DelegationMode mode;
        uint256 total;
        EnumerableAddressToUintMap.AddressToUintMap delegates;
    }

    /**
     * @notice Add or replace an existing delegate with explicitly delegated vote power.
     * @param self A DelegationState instance to manage.
     * @param delegate The address of the delegate to add/replace
     * @param amount Explicit vote power allocation to the delegate.
     * @dev If you send an `amount` of zero, `delegate` will be deleted if one
     *  exists in the delegation; if zero and `delegate` does not exist, it will not be added.
     */
    function addReplaceDelegateByAmount(
        DelegationState storage self, 
        address delegate, 
        uint256 amount) internal {

        // Delegation mode must be able to accept amount
        assert(self.mode == DelegationMode.AMOUNT || self.mode == DelegationMode.NOTSET);

        // Put the delegate in the map
        addReplaceDelegate(self, delegate, amount);

        // Make sure the mode is set
        if (self.delegates.length() == 0) {
            self.mode = DelegationMode.NOTSET;
        } else if (self.mode != DelegationMode.AMOUNT) {
            self.mode = DelegationMode.AMOUNT;
        }
    }

    /**
     * @notice Add or replace an existing delegate with allocated vote power in basis points.
     * @param self A DelegationState instance to manage.
     * @param delegate The address of the delegate to add/replace
     * @param bips Allocation of the delegation specified in basis points (1/100 of 1 percent)
     * @dev If you send a `bips` of zero, `delegate` will be deleted if one
     *  exists in the delegation; if zero and `delegate` does not exist, it will not be added.
     */
    function addReplaceDelegateByPercent(
        DelegationState storage self, 
        address delegate, 
        uint16 bips) internal {

        // Check for max delegation basis points
        assert(bips <= MAX_BIPS);

        // Delegation mode must be able to accept percentages
        assert(self.mode == DelegationMode.PERCENTAGE || self.mode == DelegationMode.NOTSET);

        // Put the delegate in the map
        addReplaceDelegate(self, delegate, bips);

        uint256 delegateCount = self.delegates.length();

        // Check total count cap
        require(delegateCount <= MAX_DELEGATES_BY_PERCENT, MAX_DELEGATES_MSG);

        // Make sure the mode is set
        if (delegateCount == 0) {
            self.mode = DelegationMode.NOTSET;
        } else if (self.mode != DelegationMode.PERCENTAGE){
            self.mode = DelegationMode.PERCENTAGE;
        }
    }

    /**
     * @notice Add or replace an existing VotingDelegate from the delgation.
     * @param self A DelegationState instance to manage.
     * @param delegate The address of the delegate to add/replace
     * @param amountOrBips The value of the delegation - either an explicit amount or a
     *  percentage specified in basis points (1/100 of 1 percent)
     * @dev If you send a `percent` of zero, `delegate` will be deleted if one
     *  exists in the delegation; if zero and `delegate` does not exist, it will not be added.
     */
    function addReplaceDelegate(
        DelegationState storage self, 
        address delegate, 
        uint256 amountOrBips) private {

        // Removing a delegate?
        if (amountOrBips == 0) {
            tryRemoveDelegate(self, delegate);
        } else {
            // Does the delegate exist?
            (bool found, uint256 oldValue) = tryFindDelegate(self, delegate);
            if (found) {
                // Back out old value from the total
                updateTotal(self, oldValue, false);
            }
            // Add/update a delegate
            self.delegates.set(delegate, amountOrBips);

            // Add new value to the total
            updateTotal(self, amountOrBips, true);
        }
    }

    /**
     * @notice Get the total number of delegates.
     * @param self A DelegationState instance to manage.
     * @return count The total number of delegates.
     */
    function getDelegateCount(
        DelegationState storage self) internal view returns (uint256 count) {

        return self.delegates.length();
    }

    /**
     * @notice Get the total of the explicit vote power delegation amount or bips of all delegates.
     * @param self A DelegationState instance to manage.
     * @return totalAmountOrBips The total vote power amount or bips delegated.
     */
    function getDelegateTotal(
        DelegationState storage self) internal view returns (uint256 totalAmountOrBips) {

        return self.total;
    }

    /**
     * @notice Get the delegation mode of the current delegation.
     * @param self A DelegationState instance to manage.
     * @dev The can be two types of delegation: a delegation by percentage of vote power, or
     *  an explicit delegation by vote power amount. There can be only one mode used at a time
     *  for a given delegator.
     * @return delegationMode The DelegationMode of the current delegation.
     */
    function getDelegationMode(
        DelegationState storage self) internal view returns(DelegationMode delegationMode) {
        return self.mode;
    }

    /**
     * @notice Given a delegate address, return the explicit amount of bips of the vote power delegation.
     * @param self A DelegationState instance to manage.
     * @param delegate The delegate address to find.
     * @return found True if the address was found. False otherwise. If false, percent is undetermined.
     * @return amountOrBips The percent or basis points of vote power allocated to the delegate address.
     */
    function tryFindDelegate(
        DelegationState storage self, 
        address delegate) internal view returns(bool found, uint256 amountOrBips) {

        return self.delegates.tryGet(delegate);
    }

    /**
     * @notice Retrieves the `delegate` address and vote power delegation `amountOrBips` at the array 
     *  `index`. `index` must be less than or equal to number of delegates.
     * @param self A DelegationState instance to manage.
     * @param index The index of a delegate. There are no guarantees on ordering of delegates
     *  and it may change when delegates are added or removed.
     * @return delegate The address of the delegate found at `index`.
     * @return amountOrBips The amount of explicit vote power or basis points delegated found at `index`.
     */
    function getDelegateAt(
        DelegationState storage self, 
        uint256 index) internal view returns(address delegate, uint256 amountOrBips) {

        return self.delegates.at(index);
    }

    /**
     * @notice Given a delegate address, remove the delegate from the delegation.
     * @param self A DelegationState instance to manage.
     * @param delegate The address of the delegate to remove.
     * @return found If the delegate was found and removed, returns true. False otherwise.
     */
    function tryRemoveDelegate(
        DelegationState storage self, 
        address delegate) internal returns(bool found) {

        uint256 oldValue;
        (found, oldValue) = tryFindDelegate(self, delegate);
        if (found) {
            self.delegates.remove(delegate);
            // Update total delegation amount of bips.
            updateTotal(self, oldValue, false);
        }
        // Sync delegation mode.
        if (self.delegates.length() == 0) {
            self.mode == DelegationMode.NOTSET;
        }
        return found;
    }

    function updateTotal(DelegationState storage self, uint256 amountOrBips, bool add) private {
        if (amountOrBips != 0) {
            // Update the total
            add ? self.total = self.total.add(amountOrBips) : self.total = self.total.sub(amountOrBips, "Total < 0");
            // Check the max total
            if (self.mode == DelegationMode.PERCENTAGE) {
                require(self.total <= MAX_BIPS, MAX_BIPS_MSG);
            }
        }
    }

    /**
     * @notice Clears all delegates.
     * @param self A DelegationState instance to manage.
     * @dev Resets the DelegationMode to NOTSET in the process.
     */
    function clear(DelegationState storage self) internal {
        self.delegates.clear();
        self.mode = DelegationMode.NOTSET;
        self.total = 0;
    }
}