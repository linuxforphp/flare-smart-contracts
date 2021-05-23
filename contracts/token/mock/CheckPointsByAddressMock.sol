// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointsByAddress} from "../lib/CheckPointsByAddress.sol";

/**
 * @title Check Points By Address Mock contract
 * @notice A contract to stub checkpoint history for a collection of addresses library 
 *  for unit testing.
 **/
contract CheckPointsByAddressMock {
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;

    CheckPointsByAddress.CheckPointsByAddressState private state;

    function valueOfAtNow(address _owner) public view returns (uint256) {
        return state.valueOfAtNow(_owner);
    }
    function valueOfAt(address _owner, uint256 _blockNumber) public view returns (uint256) {
        return state.valueOfAt(_owner, _blockNumber);
    }
    function transmit(address _from, address _to, uint256 _amount) public {
        state.transmit(_from, _to, _amount);
    }
    function writeValueOfAtNow(address _owner, uint256 _value) public returns (uint256 _blockNumber) {
        return state.writeValueOfAtNow(_owner, _value);
    }
}
