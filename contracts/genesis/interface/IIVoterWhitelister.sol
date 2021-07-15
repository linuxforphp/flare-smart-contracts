// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IVoterWhitelister.sol";

interface IIVoterWhitelister is IVoterWhitelister {
    /**
     * Set the maximum number of voters in the whitelist for FTSO at index `_ftsoIndex`.
     * Possibly removes several voters with the least votepower from the whitelist.
     * Only governance can call this method.
     */
    function setMaxVotersForFtso(uint256 _ftsoIndex, uint256 _newMaxVoters) external;

    /**
     * Set the maximum number of voters in the whitelist for a new FTSO.
     * Only governance can call this method.
     */
    function setDefaultMaxVotersForFtso(uint256 _defaultMaxVotersForFtso) external;

    /**
     * Changes ftsoRegistry address.
     * Only price submitter can call this method.
     */
    function setFtsoRegistry(IFtsoRegistry _ftsoRegistry) external;

    /**
     * Create whitelist with default size for ftso.
     * Only price submitter can call this method.
     */
    function addFtso(uint256 _ftsoIndex) external;
    
    /**
     * Clear whitelist for ftso at `_ftsoIndex`.
     * Only price submitter can call this method.
     */
    function removeFtso(uint256 _ftsoIndex) external;
}
