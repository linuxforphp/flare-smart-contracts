// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Accounting contract
 * @notice This abstract contract sets up access control for all accounting implementation contracts.
 **/

abstract contract Accounting is AccessControl {
    bytes32 public constant POSTER_ROLE = keccak256("POSTER_ROLE");

    modifier onlyPosters () {
        require (hasRole(POSTER_ROLE, msg.sender), "not poster");
        _;
    }

    constructor(address _governance) {
        require(_governance != address(0), "governance zero");
        _setupRole(DEFAULT_ADMIN_ROLE, _governance);
    }
}
