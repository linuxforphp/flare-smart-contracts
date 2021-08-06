// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Tester2 contract
 **/
contract Tester2 {

    uint256[] public array;
    uint256 public maxLen;

    constructor(uint256 n) {
        maxLen = n;
    }

    function push(uint256 n) external {
        for(uint256 i = 0; i < n; i++) {
            array.push(5);
        }
    }

    function clean(uint256 n) external {
        uint256 cnt = 0;
        while(array.length > maxLen && cnt < n) {
            array.pop();
            cnt++;
        }
    }

    function length() public view returns (uint256) {
        return array.length;
    }

}
