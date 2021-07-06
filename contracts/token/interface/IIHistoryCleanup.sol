// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../token/interface/IIVPToken.sol";
import "../../ftso/implementation/FtsoManager.sol";

interface IIHistoryCleanup  {

    /**
     * @notice Sets FTSO manager.
     */
    function setFtsoManager(FtsoManager _ftsoManager) external;

    /**
     * @notice Register a contract of which history cleanup index is to be managed
     * @param _vpToken     The address of the contract to be managed.
     */
    function registerToCleanHistory(IIVPToken _vpToken) external;

    /**
     * @notice Unregiseter a contract from history cleanup index management
     * @param _vpToken     The address of the contract to unregister.
     */
    function unregisterToCleanHistory(IIVPToken _vpToken) external;

    /**
     * @notice Triggers cleaning up to a block number
     */
    function cleanupUpToBlock(uint256 _blockNumber) external;

}
