// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { GovernedBase } from "./GovernedBase.sol";


/**
 * @title Governed
 * @dev For deployed, governed contracts, enforce a non-zero address at create time.
 **/
contract Governed is GovernedBase {
    uint256 internal constant GOVERNANCE_TIMELOCK = 7 days;
    
    constructor(address _governance) GovernedBase(_governance, GOVERNANCE_TIMELOCK) {
        require(_governance != address(0), "_governance zero");
    }
}
