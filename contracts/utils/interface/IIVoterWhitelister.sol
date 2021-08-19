// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IFtsoRegistry.sol";
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
     * Sets ftsoRegistry and ftsoManager addresses.
     * Only governance can call this method.
     */
    function setContractAddresses(IFtsoRegistry _ftsoRegistry, address _ftsoManager) external;

    /**
     * Create whitelist with default size for ftso.
     * Only ftso manager can call this method.
     */
    function addFtso(uint256 _ftsoIndex) external;
    
    /**
     * Clear whitelist for ftso at `_ftsoIndex`.
     * Only ftso manager can call this method.
     */
    function removeFtso(uint256 _ftsoIndex) external;

    /**
     * Remove `_trustedAddress` from whitelist for ftso at `_ftsoIndex`.
     */
    function removeTrustedAddressFromWhitelist(address _trustedAddress, uint256 _ftsoIndex) external;
}
