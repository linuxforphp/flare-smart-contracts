// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IVPTokenEvents {
    /**
     * Event triggered when an account delegates or undelegates another account. 
     * For undelegation, newVotePower is 0.
     */
    event Delegate(address indexed from, address indexed to, uint priorVotePower, uint newVotePower, uint blockNumber);
    
    /**
     * Event triggered only when account `delegator` revokes delegation to `delegatee`
     * for a single block in the past (typically the current vote block).
     */
    event Revoke(address indexed delegator, address indexed delegatee, uint votePower, uint blockNumber);
}
