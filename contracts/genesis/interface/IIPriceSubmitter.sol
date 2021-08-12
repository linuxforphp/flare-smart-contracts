// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IIFtsoRegistry.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "./IIVoterWhitelister.sol";

interface IIPriceSubmitter is IPriceSubmitter{

    /**
     * Sets ftso manager that will be allowed to manipulate ftsos.
     * Only governance can call this method.
     */
    function setFtsoManager(IIFtsoManager _ftsoManager) external;
    
    /**
     * Sets ftso registry.
     * Only governance can call this method.
     */
    function setFtsoRegistry(IIFtsoRegistry _ftsoRegistryToSet) external;
    
    /**
     * Sets voter whitelist implementation.
     * Only governance can call this method.
     * If replacing the whitelist and the old one is not empty, make sure to replicate the state, otherwise
     * internal whitelist bitmaps won't match.
     */
    function setVoterWhitelister(IIVoterWhitelister _voterWhitelister) external;

    /**
     * Add ftso to allow price submissions.
     * Only ftso manager can call this method.
     * `_ftso` must already be in ftso registry and `_ftsoIndex` must match that in the registry.
     */
    function addFtso(uint256 _ftsoIndex) external;
    
    /**
     * Remove ftso and disallow price submissions.
     * Only ftso manager can call this method.
     * `_ftso` must already be in ftso registry and `_ftsoIndex` must match that in the registry.
     */
    function removeFtso(uint256 _ftsoIndex) external;

    /**
     * Called from whitelister when new voter has been whitelisted.
     */
    function voterWhitelisted(address _voter, uint256 _ftsoIndex) external;
    
    /**
     * Called from whitelister when one or more voters have been removed.
     */
    function votersRemovedFromWhitelist(address[] memory _voters, uint256 _ftsoIndex) external;
}
