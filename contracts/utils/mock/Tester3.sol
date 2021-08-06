// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title Tester3 contract
 **/
contract Tester3 {

    uint256 public lastMedian;

    function push(uint256 n) external {
        if(n == 0) {
            return;
        }
        uint256[] memory array = new uint256[](n);
        uint256 tmp = 1;
        for(uint256 i = 0; i < n; i++) {
            tmp = uint256(keccak256(abi.encode(tmp)));
            array[i] = tmp;            
        }        
        bubblesort(array);
        lastMedian = array[n/2];
    }

    function bubblesort(uint256[] memory array) internal pure {
        bool changed = true;
        while(changed) {
            changed = false;
            for(uint256 i = 0; i < array.length - 1; i++) {
                if(array[i] > array[i + 1]) {
                    uint256 tmp = array[i];
                    array[i] = array[i + 1];
                    array[i + 1] = tmp;
                    changed = true;
                }
            }
        }
    }

}
