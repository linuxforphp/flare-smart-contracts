// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Tester4 contract
 **/
contract Tester4 {

    uint256 public a;

    function push(uint256 n) external {
        for(uint256 i = 0; i < n; i++) {
            a += 1;
        }
    }
}
