// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointHistory} from "./CheckPointHistory.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Check Points By Address library
 * @notice A contract to manage checkpoint history for a collection of addresses.
 * @dev Store value history by address, and then by block number.
 **/
library CheckPointsByAddress {
    using SafeMath for uint256;
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;

    struct CheckPointsByAddressState {
        // `historyByAddress` is the map that stores the check point history of each address
        mapping (address => CheckPointHistory.CheckPointHistoryState) historyByAddress;
    }

    /**
    /**
     * @notice Send `amount` value to `to` address from `from` address.
     * @param self A CheckPointsByAddressState instance to manage.
     * @param from Address of the history of from values 
     * @param to Address of the history of to values 
     * @param amount The amount of value to be transferred
     * @param blockNumber The block of recorded transmission
     **/
    function transmit(
        CheckPointsByAddressState storage self, 
        address from, 
        address to, 
        uint256 amount) internal returns (uint256 blockNumber) {

        // Shortcut
        if (amount == 0) {
            return block.number;
        }

        // Both from and to can never be zero
        assert(!(from == address(0) && to == address(0)));

        // Update transferer value
        if (from != address(0)) {
            // Compute the new from balance
            uint256 newValueFrom = valueOfAtNow(self, from).sub(amount);
            writeValueOfAtNow(self, from, newValueFrom);
        }

        // Update transferee value
        if (to != address(0)) {
            // Compute the new to balance
            uint256 newValueTo = valueOfAtNow(self, to).add(amount);
            writeValueOfAtNow(self, to, newValueTo);
        }
        
        return block.number;
    }

    /**
     * @notice Queries the value of `owner` at a specific `blockNumber`.
     * @param self A CheckPointsByAddressState instance to manage.
     * @param owner The address from which the value will be retrieved.
     * @param blockNumber The block number to query for the then current value.
     * @return The value at `blockNumber` for `owner`.
     **/
    function valueOfAt(
        CheckPointsByAddressState storage self, 
        address owner, 
        uint blockNumber) internal view returns (uint256) {
          
        // Get history for owner
        CheckPointHistory.CheckPointHistoryState storage history = self.historyByAddress[owner];
        // Return value at given block
        return history.valueAt(blockNumber);
    }

    /**
     * @notice Get the value of the `owner` at the current `block.number`.
     * @param self A CheckPointsByAddressState instance to manage.
     * @param owner The address of the value is being requested.
     * @return The value of `owner` at the current block.
     **/
    function valueOfAtNow(CheckPointsByAddressState storage self, address owner) internal view returns (uint256) {
        return valueOfAt(self, owner, block.number);
    }

    /**
     * @notice Writes the `value` at the current block number for `owner`.
     * @param self A CheckPointsByAddressState instance to manage.
     * @param owner The address of `owner` to write.
     * @param value The value to write.
     * @return blockNumber The block that the value was written at. 
     * @dev Sender must be the owner of the contract.
     **/
    function writeValueOfAtNow(
        CheckPointsByAddressState storage self, 
        address owner, 
        uint256 value) internal returns (uint256 blockNumber) {

        // Get history for owner
        CheckPointHistory.CheckPointHistoryState storage history = self.historyByAddress[owner];
        // Write the value
        history.writeValue(value);
        
        return block.number;
    }
}