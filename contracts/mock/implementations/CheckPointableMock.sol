// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointable} from "../../implementations/CheckPointable.sol";

/**
 * @title CheckPointable mock contract
 * @notice A contract to instantiate the abstract CheckPointable contract for unit testing.
 **/
contract CheckPointableMock is CheckPointable {
    function burnForAtNow(address owner, uint256 amount) public {
        _burnForAtNow(owner, amount);
    }
    function mintForAtNow(address owner, uint256 amount) public {
        _mintForAtNow(owner, amount);
    }
    function transmitAtNow(address from, address to, uint256 amount) public {
        _transmitAtNow(from, to, amount);
    }
}