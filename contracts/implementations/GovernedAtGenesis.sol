// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { Governed } from "./Governed.sol";

/**
 * @title Governed At Genesis
 * @dev This contract enforces a fixed governance address when the constructor
 *  is not executed on a contract (for instance when directly loaded to the genesis block).
 *  This is required to fix governance on a contract when the network starts, at such point
 *  where theoretically no accounts yet exist, and leaving it ungoverned could result in a race
 *  to claim governance by an unauthorized address.
 **/
contract GovernedAtGenesis is Governed {
    constructor(address _governance) Governed(_governance) { }

    /**
     * @notice Set governance to a fixed address when constructor is not called.
     **/
     
    function initialiseFixedAddress() external {
        address governanceAddress = address(0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7);
        
        super.initialise(governanceAddress);
    }

    /**
     * @notice Disallow initialise to be called
     * @param _governance The governance address for initial claiming
     **/
    function initialise(address _governance) public override pure {
        assert(false);
    }
}