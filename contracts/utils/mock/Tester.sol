// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Tester contract
 **/
contract Tester {

    mapping(address => mapping(uint256 => uint256[])) public addressAndBlockToNumber;

    function push(uint256 n) external {
        for(uint256 i = 0; i < n; i++) {
            addressAndBlockToNumber[msg.sender][block.number].push(5);
        }
    }

}
