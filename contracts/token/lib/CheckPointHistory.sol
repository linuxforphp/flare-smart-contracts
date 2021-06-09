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
     * @notice Binary search of _checkpoints array.
     * @param _checkpoints An array of CheckPoint to search.
     * @param _blockNumber The block number to search for.
     */
    function _indexOfGreatestBlockLessThan(
        CheckPoint[] storage _checkpoints, 
        uint256 _blockNumber
    ) private view returns (uint256 index) {
        // Binary search of the value by given block number in the array
        uint256 min = 0;
        uint256 max = _checkpoints.length.sub(1);
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (_checkpoints[mid].fromBlock <= _blockNumber) {
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    /**
     * @notice Queries the value at a specific `_blockNumber`
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _blockNumber The block number of the value active at that time
     * @return _value The value at `_blockNumber`     
     **/
    function valueAt(
        CheckPointHistoryState storage _self, 
        uint256 _blockNumber
    ) internal view returns (uint256 _value) {
        uint256 historyCount = _self.values.length;

        // No _checkpoints, return 0
        if (historyCount == 0) return 0;

        // Shortcut for the actual value
        if (_blockNumber >= _self.values[historyCount - 1].fromBlock)
            return _self.values[historyCount - 1].value;
        if (_blockNumber < _self.values[0].fromBlock) return 0;

        // Find the block with number less than or equal to block given
        uint256 index = _indexOfGreatestBlockLessThan(_self.values, _blockNumber);

        return _self.values[index].value;
    }

    /**
     * @notice Queries the value at `block.number`
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _value The value at `block.number`
     **/
    function valueAtNow(CheckPointHistoryState storage _self) internal view returns (uint256 _value) {
        return valueAt(_self, block.number);
    }

    /**
     * @notice Writes the value at the current block.
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _value Value to write.
     **/
    function writeValue(
        CheckPointHistoryState storage _self, 
        uint256 _value
    ) internal {
        uint256 historyCount = _self.values.length;
        if (historyCount == 0) {
            // values array empty, push new CheckPoint
            _self.values.push(CheckPoint({fromBlock: block.number, value: _value}));
        } else {
            CheckPoint storage lastCheckpoint = _self.values[historyCount - 1];
            uint256 lastBlock = lastCheckpoint.fromBlock;
            // slither-disable-next-line incorrect-equality
            if (block.number == lastBlock) {
                // If last check point is the current block, just update
                lastCheckpoint.value = _value;
            } else {
                // we should never have future blocks in history
                assert (block.number > lastBlock);
                // push new CheckPoint
                _self.values.push(CheckPoint({fromBlock: block.number, value: _value}));
            }
        }
    }
}
