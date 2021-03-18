// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointsByAddress} from "../../lib/CheckPointsByAddress.sol";

/**
 * @title Check Points By Address Mock contract
 * @notice A contract to stub checkpoint history for a collection of addresses library 
 *  for unit testing.
 **/
contract CheckPointsByAddressMock {
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;

    CheckPointsByAddress.CheckPointsByAddressState private _state;

    function valueOfAtNow(address owner) public view returns (uint256) {
        return _state.valueOfAtNow(owner);
    }
    function valueOfAt(address owner, uint blockNumber) public view returns (uint256) {
        return _state.valueOfAt(owner, blockNumber);
    }
    function transmitAt(
        address from, 
        address to, 
        uint256 amount, 
        uint256 blockNumber) public {
        _state.transmitAt(from, to, amount, blockNumber);
    }
    function transmitAtNow(address from, address to, uint256 amount) public {
        _state.transmitAtNow(from, to, amount);(from, to, amount);
    }
    function writeValueOfAt(
        address owner, 
        uint256 value,
        uint256 blockNumber) public {
        _state.writeValueOfAt(owner, value, blockNumber);
    }
    function writeValueOfAtNow(address owner, uint256 value) public returns (uint256 blockNumber) {
        return _state.writeValueOfAtNow(owner, value);
    }
}