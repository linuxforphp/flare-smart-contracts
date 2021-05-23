// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointHistory} from "./CheckPointHistory.sol";
import {DelegationHistory} from "./DelegationHistory.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../../lib/SafePct.sol";

/**
 * @title PercentageDelegation library
 * @notice Only handles percentage delegation  
 * @notice A library to manage a group of delegates for allocating voting power by a delegator.
 **/
library PercentageDelegation {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using DelegationHistory for DelegationHistory.CheckPointHistoryState;
    using SafeMath for uint256;
    using SafePct for uint256;

    uint256 public constant MAX_BIPS = 10000;
    string private constant MAX_BIPS_MSG = "Max delegation bips exceeded";
    
    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of delegates (a PercentageDelegation) for a delegator.
     */
    struct DelegationState {
        // percentages by delegates
        DelegationHistory.CheckPointHistoryState delegation;
    }

    /**
     * @notice Add or replace an existing delegate with allocated vote power in basis points.
     * @param self A DelegationState instance to manage.
     * @param delegate The address of the delegate to add/replace
     * @param bips Allocation of the delegation specified in basis points (1/100 of 1 percent)
     * @dev If you send a `bips` of zero, `delegate` will be deleted if one
     *  exists in the delegation; if zero and `delegate` does not exist, it will not be added.
     */
    function addReplaceDelegate(
        DelegationState storage self, 
        address delegate, 
        uint256 bips
    ) internal {
        // Check for max delegation basis points
        assert(bips <= MAX_BIPS);

        // Change the delegate's percentage
        self.delegation.writeValue(delegate, bips);
        
        // check the total
        require(self.delegation.totalValueAtNow() <= MAX_BIPS, MAX_BIPS_MSG);
    }

    /**
     * @notice Get the total of the explicit vote power delegation amount or bips of all delegates at given block.
     * @param self A DelegationState instance to manage.
     * @param blockNumber The block to query.
     * @return totalBips The total vote power amount or bips delegated.
     */
    function getDelegatedTotalAt(
        DelegationState storage self,
        uint256 blockNumber
    ) internal view returns (uint256 totalBips) {
        return self.delegation.totalValueAt(blockNumber);
    }

    /**
     * @notice Get the total of the explicit vote power delegation amount or bips of all delegates.
     * @param self A DelegationState instance to manage.
     * @return totalBips The total vote power amount or bips delegated.
     */
    function getDelegatedTotal(
        DelegationState storage self
    ) internal view returns (uint256 totalBips) {
        return self.delegation.totalValueAtNow();
    }

    /**
     * @notice Given a delegate address, return the explicit amount of bips of the vote power delegation.
     * @param self A DelegationState instance to manage.
     * @param delegate The delegate address to find.
     * @param blockNumber The block to query.
     * @return bips The percent of vote power allocated to the delegate address.
     */
    function getDelegatedValueAt(
        DelegationState storage self, 
        address delegate,
        uint256 blockNumber
    ) internal view returns (uint256 bips) {
        return self.delegation.valueOfAt(delegate, blockNumber);
    }

    /**
     * @notice Given a delegate address, return the explicit amount of bips of the vote power delegation.
     * @param self A DelegationState instance to manage.
     * @param delegate The delegate address to find.
     * @return bips The percent of vote power allocated to the delegate address.
     */
    function getDelegatedValue(
        DelegationState storage self, 
        address delegate
    ) internal view returns (uint256 bips) {
        return self.delegation.valueOfAtNow(delegate);
    }

    /**
     * @notice Returns lists of delegate addresses and corresponding values at given block.
     * @param self A DelegationState instance to manage.
     * @param blockNumber The block to query.
     * @return delegates Positional array of delegation addresses.
     * @return values Positional array of delegation percents specified in basis points (1/100 or 1 percent)
     */
    function getDelegationsAt(
        DelegationState storage self,
        uint256 blockNumber
    ) internal view returns (
        address[] memory delegates,
        uint256[] memory values
    ) {
        return self.delegation.delegationsAt(blockNumber);
    }
    
    /**
     * @notice Returns lists of delegate addresses and corresponding values.
     * @param self A DelegationState instance to manage.
     * @return delegates Positional array of delegation addresses.
     * @return values Positional array of delegation percents specified in basis points (1/100 or 1 percent)
     */
    function getDelegations(
        DelegationState storage self
    ) internal view returns (
        address[] memory delegates,
        uint256[] memory values
    ) {
        return self.delegation.delegationsAtNow();
    }
    
    /**
     * @notice Clears all delegates.
     * @param self A DelegationState instance to manage.
     * @dev Resets the DelegationMode to NOTSET in the process.
     */
    function clear(DelegationState storage self) internal {
        self.delegation.clear();
    }
}