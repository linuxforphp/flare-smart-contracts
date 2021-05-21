// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../ftso/interface/IIFtso.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../../ftso/interface/IIFtso.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../../userInterfaces/IFtsoManager.sol";

interface IIFtsoManager is IFtsoManager {

    // TODO: Remove this event for production
    event KeepTrigger(uint256 blockNumber, uint256 timestamp);  // for monitoring keep() calls

    function activate() external;
    function deactivate() external;

    function setGovernanceParameters(
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutBIPSThreshold,
        uint256 _lowFlrTurnoutBIPSThreshold,
        address[] memory _trustedAddresses
    ) external;

    function addFtso(IIFtso _ftso) external;
    function removeFtso(IIFtso _ftso) external;

    function setFtsoFAsset(IIFtso _ftso, IVPToken _fAsset) external;
    function setFtsoFAssetFtsos(IIFtso _ftso, IIFtso[] memory _fAssetFtsos) external;

    function setPanicMode(bool _panicMode) external;
    function setFtsoPanicMode(IIFtso _ftso, bool _panicMode) external;
}
