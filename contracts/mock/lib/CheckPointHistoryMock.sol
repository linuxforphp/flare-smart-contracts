// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointHistory} from "../../lib/CheckPointHistory.sol";

/**
 * @title Check Point History Mock contract
 * @notice A contract to stub the CheckPointHistory library for testing.
 **/
contract CheckPointHistoryMock {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;

    CheckPointHistory.CheckPointHistoryState private _state;

    function valueAt(uint256 blockNumber) public view returns (uint256 value) {
        return _state.valueAt(blockNumber);
    }
    function valueAtNow() public view returns (uint256 value) {
        return _state.valueAtNow();
    }
    function writeValueAt(uint256 value, uint256 blockNumber) public {
        return _state.writeValueAt(value, blockNumber);
    }
    function writeValueAtNow(uint256 value) public returns (uint256 blockNumber) {
        return _state.writeValueAtNow(value);
    }
}