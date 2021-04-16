// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Check Point History library
 * @notice A contract to manage values as of a given block.
 * @dev Store value history by block number with detachable state.
 **/
library CheckPointHistory {
    using SafeMath for uint256;

    /**
     * @dev `CheckPoint` is the structure that attaches a block number to a
     *  given value; the block number attached is the one that last changed the
     *  value
     **/
    struct CheckPoint {
        // `fromBlock` is the block number that the value was generated from
        uint256 fromBlock;
        // `value` is the amount of tokens at a specific block number
        uint256 value;
    }

    struct CheckPointHistoryState {
        // `values` is an array that tracks values at non-contiguous block numbers
        CheckPoint[] values;
    }

    /**
     * @notice Binary search of checkpoints array.
     * @param checkpoints An array of CheckPoint to search.
     * @param blockNumber The block number to search for.
     */
    function indexOfGreatestBlockLessThan(
        CheckPoint[] storage checkpoints, 
        uint256 blockNumber) private view returns (uint256 index) {
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
     * @notice Queries the value at a specific `blockNumber`
     * @param self A CheckPointHistoryState instance to manage.
     * @param blockNumber The block number of the value active at that time
     * @return value The value at `blockNumber`     
     **/
    function valueAt(CheckPointHistoryState storage self, uint256 blockNumber) internal view returns (uint256 value) {
        uint256 historyCount = self.values.length;

        // No checkpoints, return 0
        if (historyCount == 0) return 0;

        // Shortcut for the actual value
        if (blockNumber >= self.values[historyCount - 1].fromBlock)
            return self.values[historyCount - 1].value;
        if (blockNumber < self.values[0].fromBlock) return 0;

        // Find the block with number less than or equal to block given
        uint256 index = indexOfGreatestBlockLessThan(self.values, blockNumber);

        return self.values[index].value;
    }

    /**
     * @notice Queries the value at `block.number`
     * @param self A CheckPointHistoryState instance to manage.
     * @return value The value at `block.number`
     **/
    function valueAtNow(CheckPointHistoryState storage self) internal view returns (uint256 value) {
        value = valueAt(self, block.number);
        return value;
    }

    /**
     * @notice Writes `value` at `blockNumber`.
     * @param self A CheckPointHistoryState instance to manage.
     * @param value Value to write.
     * @param blockNumber The block at which to write.
     **/
    function writeValueAt(CheckPointHistoryState storage self, uint256 value, uint256 blockNumber) internal {
        uint256 historyCount = self.values.length;

        if (historyCount == 0) {
            // values array empty, push new CheckPoint
            self.values.push(CheckPoint({fromBlock: blockNumber, value: value}));
        } else if (blockNumber == self.values[historyCount - 1].fromBlock) {
            // If last check point is blockNumber input, just update
            self.values[historyCount - 1].value = value;
        } else if (blockNumber > self.values[historyCount - 1].fromBlock) {
            // If last check point block is before
            self.values.push(CheckPoint({fromBlock: blockNumber, value: value}));
        } else {
            // Find the block with number less than or equal to block given
            uint256 index = indexOfGreatestBlockLessThan(self.values, blockNumber);
            // Update the checkpoint value
            self.values[index].value = value;
        }
    }

    /**
     * @notice Writes the value at the current block.
     * @param self A CheckPointHistoryState instance to manage.
     * @param value Value to write.
     * @return blockNumber The block number that the value was written at. 
     **/
    function writeValueAtNow(
        CheckPointHistoryState storage self, 
        uint256 value) internal returns (uint256 blockNumber) {
          
        writeValueAt(self, value, block.number);
        return block.number;
    }
}
