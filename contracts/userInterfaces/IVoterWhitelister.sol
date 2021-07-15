// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IFtsoRegistry.sol";

interface IVoterWhitelister {
    /**
     * Raised when an account is removed from the voter whitelist.
     */
    event VoterWhitelisted(address voter, uint256 ftsoIndex);
    
    /**
     * Raised when an account is removed from the voter whitelist.
     */
    event VoterRemovedFromWhitelist(address voter, uint256 ftsoIndex);

    /**
     * Try adding `_voter` account to the whitelist if it has enough voting power.
     */
    function requestWhitelistingVoter(address _voter, uint256 _ftsoIndex) external;

    /**
     * Try to add voter to all whitelists.
     */
    function requestFullVoterWhitelisting(address _voter) external;

    /**
     * Maximum number of voters in the whitelist for a new FTSO.
     */
    function defaultMaxVotersForFtso() external view returns (uint256);
    
    /**
     * Maximum number of voters in the whitelist for FTSO at index `_ftsoIndex`.
     */
    function maxVotersForFtso(uint256 _ftsoIndex) external view returns (uint256);
}
