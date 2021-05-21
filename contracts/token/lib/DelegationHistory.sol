// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title DelegationHistory library
 * @notice A contract to manage checkpoints as of a given block.
 * @dev Store value history by block number with detachable state.
 **/
library DelegationHistory {
    using SafeMath for uint256;

    uint public constant MAX_DELEGATES_BY_PERCENT = 3;
    string private constant MAX_DELEGATES_MSG = "Max delegates exceeded";
    
    /**
     * @dev `CheckPoint` is the structure that attaches a block number to a
     *  given value; the block number attached is the one that last changed the
     *  value
     **/
    struct CheckPoint {
        // `fromBlock` is the block number that the value was generated from
        uint256 fromBlock;
        // the list of active delegates at this time
        address[] delegates;
        // the values delegated to the corresponding delegate at this time
        uint256[] values;
    }

    struct CheckPointHistoryState {
        // `checkpoints` is an array that tracks checkpoints at non-contiguous block numbers
        CheckPoint[] checkpoints;
    }

    /**
     * @notice Queries the value at a specific `blockNumber`
     * @param self A CheckPointHistoryState instance to manage.
     * @param delegate The delegate for which we need value.
     * @param blockNumber The block number of the value active at that time
     * @return value The value of the delegate at `blockNumber`     
     **/
    function valueOfAt(
        CheckPointHistoryState storage self, 
        address delegate, 
        uint256 blockNumber
    ) internal view returns (uint256 value) {
        (bool found, uint256 index) = findGreatestBlockLessThan(self.checkpoints, blockNumber);
        if (!found) return 0;

        // find the delegate and return the corresponding value
        CheckPoint storage cp = self.checkpoints[index];
        uint length = cp.delegates.length;
        for (uint i = 0; i < length; i++) {
            if (cp.delegates[i] == delegate) {
                return cp.values[i];
            }
        }
        return 0;   // delegate not found
    }

    /**
     * @notice Queries the value at `block.number`
     * @param self A CheckPointHistoryState instance to manage.
     * @param delegate The delegate for which we need value.
     * @return value The value at `block.number`
     **/
    function valueOfAtNow(
        CheckPointHistoryState storage self, 
        address delegate
    ) internal view returns (uint256 value) {
        return valueOfAt(self, delegate, block.number);
    }

    /**
     * @notice Writes the value at the current block.
     * @param self A CheckPointHistoryState instance to manage.
     * @param delegate The delegate tu update.
     * @param value The new value to set for this delegate (0 value deletes delegate from the list).
     * @return blockNumber The block number that the value was written at. 
     **/
    function writeValue(
        CheckPointHistoryState storage self, 
        address delegate, 
        uint256 value
    ) internal returns (uint256 blockNumber) {
        uint256 historyCount = self.checkpoints.length;
        if (historyCount == 0) {
            // checkpoints array empty, push new CheckPoint
            if (value != 0) {
                CheckPoint storage cp = self.checkpoints.push();
                cp.fromBlock = block.number;
                cp.delegates.push(delegate);
                cp.values.push(value);
            }
        } else if (block.number == self.checkpoints[historyCount - 1].fromBlock) {
            // If last check point is blockNumber input, just update
            updateDelegates(self.checkpoints[historyCount - 1], delegate, value);
        } else {
            // last block cannot be from the future
            assert(block.number > self.checkpoints[historyCount - 1].fromBlock); 
            // last check point block is before
            CheckPoint storage cp = self.checkpoints.push();
            cp.fromBlock = block.number;
            copyAndUpdateDelegates(cp, self.checkpoints[historyCount - 1], delegate, value);
        }
        return block.number;
    }
    
    /**
     * Get all percentage delegations active at a time.
     * @param self A CheckPointHistoryState instance to manage.
     * @param blockNumber The block number to query. 
     * @return delegates The active percentage delegates at the time. 
     * @return values The delegates' values at the time. 
     **/
    function delegationsAt(
        CheckPointHistoryState storage self,
        uint256 blockNumber
    ) internal view returns (
        address[] memory delegates,
        uint256[] memory values
    ) {
        (bool found, uint256 index) = findGreatestBlockLessThan(self.checkpoints, blockNumber);
        if (!found) {
            return (new address[](0), new uint256[](0));
        }

        // copy delegates and values to memory arrays
        // (to prevent caller updating the stored value)
        CheckPoint storage cp = self.checkpoints[index];
        uint length = cp.delegates.length;
        delegates = new address[](length);
        values = new uint256[](length);
        for (uint i = 0; i < length; i++) {
            delegates[i] = cp.delegates[i];
            values[i] = cp.values[i];
        }
    }
    
    /**
     * Get all percentage delegations active now.
     * @param self A CheckPointHistoryState instance to manage.
     * @return delegates The active percentage delegates. 
     * @return values The delegates' values. 
     **/
    function delegationsAtNow(
        CheckPointHistoryState storage self
    ) internal view returns (
        address[] memory delegates,
        uint256[] memory values
    ) {
        return delegationsAt(self, block.number);
    }
    
    /**
     * Get the sum of all delegation values.
     * @param self A CheckPointHistoryState instance to query.
     * @param blockNumber The block number to query. 
     * @return total Total delegation value at the time.
     **/
    function totalValueAt(
        CheckPointHistoryState storage self, 
        uint256 blockNumber
    ) internal view returns (uint256 total) {
        (bool found, uint256 index) = findGreatestBlockLessThan(self.checkpoints, blockNumber);
        if (!found) return 0;
        
        CheckPoint storage cp = self.checkpoints[index];
        uint length = cp.values.length;
        total = 0;
        for (uint i = 0; i < length; i++) {
            total += cp.values[i];
        }
    }

    /**
     * Get the sum of all delegation values.
     * @param self A CheckPointHistoryState instance to query.
     * @return total Total delegation value at the time.
     **/
    function totalValueAtNow(
        CheckPointHistoryState storage self
    ) internal view returns (uint256 total) {
        return totalValueAt(self, block.number);
    }

    /**
     * Clear all delegations at this moment.
     * @param self A CheckPointHistoryState instance to manage.
     */    
    function clear(CheckPointHistoryState storage self) internal {
        if (self.checkpoints.length > 0) {
            // add an empty checkpoint
            CheckPoint storage cp = self.checkpoints.push();
            cp.fromBlock = block.number;
        }
    }

    /////////////////////////////////////////////////////////////////////////////////
    // helper functions for writeValueAt
    
    function copyAndUpdateDelegates(
        CheckPoint storage cp, 
        CheckPoint storage orig, 
        address delegate, 
        uint256 value
    ) private {
        uint length = orig.delegates.length;
        bool updated = false;
        for (uint i = 0; i < length; i++) {
            address origDelegate = orig.delegates[i];
            if (origDelegate == delegate) {
                // copy delegate, but with new value
                appendDelegate(cp, origDelegate, value, i);
                updated = true;
            } else {
                // just copy the delegate with original value
                appendDelegate(cp, origDelegate, orig.values[i], i);
            }
        }
        if (!updated) {
            // delegate is not in the original list, so add it
            appendDelegate(cp, delegate, value, length);
        }
    }

    function updateDelegates(CheckPoint storage cp, address delegate, uint256 value) private {
        uint length = cp.delegates.length;
        uint i = 0;
        while (i < length && cp.delegates[i] != delegate) ++i;
        if (i < length) {
            if (value != 0) {
                cp.values[i] = value;
            } else {
                deleteDelegate(cp, i, length);
            }
        } else {
            appendDelegate(cp, delegate, value, length);
        }
    }
    
    function appendDelegate(CheckPoint storage cp, address delegate, uint256 value, uint length) private {
        if (value != 0) {
            require(length < MAX_DELEGATES_BY_PERCENT, MAX_DELEGATES_MSG);
            cp.delegates.push(delegate);
            cp.values.push(value);
        }
    }
    
    function deleteDelegate(CheckPoint storage cp, uint i, uint length) private {
        // no check that length > 0 (not needed, since we only call this from updateDelegates 
        // where delegate was found, therefore length > 0)
        if (i + 1 < length) {
            cp.delegates[i] = cp.delegates[length - 1];
            cp.values[i] = cp.values[length - 1];
        }
        cp.delegates.pop();
        cp.values.pop();
    }
    
    /////////////////////////////////////////////////////////////////////////////////
    // helper functions for querying
    
    /**
     * @notice Binary search of checkpoints array.
     * @param checkpoints An array of CheckPoint to search.
     * @param blockNumber The block number to search for.
     */
    function binarySearchGreatestBlockLessThan(
        CheckPoint[] storage checkpoints, 
        uint256 blockNumber
    ) private view returns (uint256 index) {
        // Binary search of the value by given block number in the array
        uint256 min = 0;
        uint256 max = checkpoints.length.sub(1);
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (checkpoints[mid].fromBlock<=blockNumber) {
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    /**
     * @notice Binary search of checkpoints array. Extra optimized for the common case when we are 
     *   searching for the last block.
     * @param checkpoints An array of CheckPoint to search.
     * @param blockNumber The block number to search for.
     * @return found true if value was found (only `false` if `blockNumber` is before first 
     *   checkpoint or the checkpoint array is empty)
     * @return index index of the newst block with number less than or equal `blockNumber`
     */
    function findGreatestBlockLessThan(
        CheckPoint[] storage checkpoints, 
        uint256 blockNumber
    ) private view returns (
        bool found,
        uint256 index
    ) {
        uint256 historyCount = checkpoints.length;
        if (historyCount == 0) {
            found = false;
        } else if (blockNumber >= checkpoints[historyCount - 1].fromBlock) {
            found = true;
            index = historyCount - 1;
        } else if (blockNumber < checkpoints[0].fromBlock) {
            found = false;
        } else {
            found = true;
            index = binarySearchGreatestBlockLessThan(checkpoints, blockNumber);
        }
    }
}
