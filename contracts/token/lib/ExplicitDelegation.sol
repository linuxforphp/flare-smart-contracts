// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointsByAddress} from "./CheckPointsByAddress.sol";
import {CheckPointHistory} from "./CheckPointHistory.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../../lib/SafePct.sol";


/**
 * @title ExplicitDelegation library
 * @notice A library to manage a group of delegates for allocating voting power by a delegator.
 **/
library ExplicitDelegation {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of delegates (a ExplicitDelegation) for a delegator.
     */
    struct DelegationState {
        CheckPointHistory.CheckPointHistoryState delegatedTotal;
        
        // `delegatedVotePower` is a map of delegators pointing to a map of delegates
        // containing a checkpoint history of delegated vote power balances.
        CheckPointsByAddress.CheckPointsByAddressState delegatedVotePower;
    }

    /**
     * @notice Add or replace an existing delegate with new vote power (explicit).
     * @param self A DelegationState instance to manage.
     * @param delegate The address of the delegate to add/replace
     * @param amount Allocation of the delegation as explicit amount
     */
    function addReplaceDelegate(
        DelegationState storage self, 
        address delegate, 
        uint256 amount
    ) internal {
        uint256 prevAmount = self.delegatedVotePower.valueOfAtNow(delegate);
        uint256 newTotal = self.delegatedTotal.valueAtNow().sub(prevAmount, "Total < 0").add(amount);
        self.delegatedVotePower.writeValueOfAtNow(delegate, amount);
        self.delegatedTotal.writeValue(newTotal);
    }
    
    /**
     * @notice Get the total of the explicit vote power delegation amount.
     * @param self A DelegationState instance to manage.
     * @param blockNumber The block to query.
     * @return total The total vote power amount delegated.
     */
    function getDelegatedTotalAt(
        DelegationState storage self, uint256 blockNumber
    ) internal view returns (uint256 total) {
        return self.delegatedTotal.valueAt(blockNumber);
    }
    
    /**
     * @notice Get the total of the explicit vote power delegation amount.
     * @param self A DelegationState instance to manage.
     * @return total The total vote power amount delegated.
     */
    function getDelegatedTotal(
        DelegationState storage self
    ) internal view returns (uint256 total) {
        return self.delegatedTotal.valueAtNow();
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
        return self.delegatedVotePower.valueOfAt(delegate, blockNumber);
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
        return self.delegatedVotePower.valueOfAtNow(delegate);
    }

}