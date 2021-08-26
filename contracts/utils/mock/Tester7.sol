// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { Tester6 } from "../mock/Tester6.sol";

/**
 * @title Tester7 contract
 **/
contract Tester7 {

    Tester6[] public tester6Contracts;

    function setContracts(Tester6[] calldata testers6) external {

        uint256 tester6Length = testers6.length;

        while (tester6Contracts.length > 0) {
            tester6Contracts.pop();
        }

        for (uint256 i = 0; i < tester6Length; i++) {
            tester6Contracts.push(testers6[i]);
        }
    }


    function push(uint256 n) external {

        uint256 tester6Length = tester6Contracts.length;

        for (uint256 i = 0; i < tester6Length; i++) {
            uint256 tmp = uint256(keccak256(abi.encode(n, i)));
            tester6Contracts[i].push(tmp);
        }
    }



}