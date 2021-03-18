// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {EnumerableMap} from "./EnumerableMap.sol";

/**
 * @title Enumerable Address to Uint library
 * @notice A library to store mapping of address to uint that are enumerable.
 * @dev An implementation of the OpenZeppelin EnumerableMap for address -> uint
 **/
library EnumerableAddressToUintMap {
    using EnumerableMap for EnumerableMap.Map;

    struct AddressToUintMap {
        EnumerableMap.Map _inner;
    }

    /**
     * @dev Remove all key/value pairs. O(N).
     *
     * Returns true if the key was added to the map, that is if it was not
     * already present.
     */
    function clear(AddressToUintMap storage map) internal {
        while(map._inner._length() > 0) {
            (bytes32 key,) = map._inner._at(map._inner._length() - 1);
            map._inner._remove(key);
        }
    }

    /**
     * @dev Adds a key-value pair to a map, or updates the value for an existing
     * key. O(1).
     *
     * Returns true if the key was added to the map, that is if it was not
     * already present.
     */
    function set(AddressToUintMap storage map, address key, uint256 value) internal returns (bool) {
        return map._inner._set(bytes32(uint256(uint160(key))), bytes32(value));
    }

    /**
     * @dev Removes a value from a set. O(1).
     *
     * Returns true if the key was removed from the map, that is if it was present.
     */
    function remove(AddressToUintMap storage map, address key) internal returns (bool) {
        return map._inner._remove(bytes32(uint256(uint160(key))));
    }

    /**
     * @dev Returns true if the key is in the map. O(1).
     */
    function contains(AddressToUintMap storage map, address key) internal view returns (bool) {
        return map._inner._contains(bytes32(uint256(uint160(key))));
    }

    /**
     * @dev Returns the number of elements in the map. O(1).
     */
    function length(AddressToUintMap storage map) internal view returns (uint256) {
        return map._inner._length();
    }

   /**
    * @dev Returns the element stored at position `index` in the set. O(1).
    * Note that there are no guarantees on the ordering of values inside the
    * array, and it may change when more values are added or removed.
    *
    * Requirements:
    *
    * - `index` must be strictly less than {length}.
    */
    function at(AddressToUintMap storage map, uint256 index) internal view returns (address, uint256) {
        (bytes32 key, bytes32 value) = map._inner._at(index);
        return (address(uint160(uint256(key))), uint256(value));
    }

    /**
     * @dev Tries to returns the value associated with `key`.  O(1).
     * Does not revert if `key` is not in the map.
     *
     * _Available since v3.4._
     */
    function tryGet(AddressToUintMap storage map, address key) internal view returns (bool, uint256) {
        (bool success, bytes32 value) = map._inner._tryGet(bytes32(uint256(uint160(key))));
        return (success, uint256(value));
    }

    /**
     * @dev Returns the value associated with `key`.  O(1).
     *
     * Requirements:
     *
     * - `key` must be in the map.
     */
    function get(AddressToUintMap storage map, address key) internal view returns (uint256) {
        return uint256(map._inner._get(bytes32(uint256(uint160(key)))));
    }

    /**
     * @dev Same as {get}, with a custom error message when `key` is not in the map.
     *
     * CAUTION: This function is deprecated because it requires allocating memory for the error
     * message unnecessarily. For custom revert reasons use {tryGet}.
     */
    function get(AddressToUintMap storage map, 
        address key, 
        string memory errorMessage) internal view returns (uint256) {
        return uint256(map._inner._get(bytes32(uint256(uint160(key))), errorMessage));
    }    
}
