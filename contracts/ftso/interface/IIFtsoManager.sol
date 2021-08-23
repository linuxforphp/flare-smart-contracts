// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../ftso/interface/IIFtso.sol";
import "../../userInterfaces/IFtsoManager.sol";
import "../../token/interface/IIVPToken.sol";


interface IIFtsoManager is IFtsoManager {

    event ClosingExpiredRewardEpochFailed(uint256 _rewardEpoch);
    event CleanupBlockNumberManagerUnset();
    event CleanupBlockNumberManagerFailedForBlock(uint256 blockNumber);

    // TODO: Remove this event for production
    event DaemonizeTrigger(uint256 blockNumber, uint256 timestamp);  // for monitoring daemonize() calls

    function activate() external;
    function deactivate() external;

    function setGovernanceParameters(
        uint256 _maxVotePowerFlrThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowFlrTurnoutThresholdBIPS,
        uint256 _rewardExpiryOffsetSeconds,
        address[] memory _trustedAddresses
    ) external;

    function addFtso(IIFtso _ftso) external;

    function removeFtso(IIFtso _ftso) external;

    function replaceFtso(
        IIFtso _ftsoToRemove,
        IIFtso _ftsoToAdd,
        bool copyCurrentPrice,
        bool copyFAssetOrFAssetFtsos
    ) external;

    function setFtsoFAsset(IIFtso _ftso, IIVPToken _fAsset) external;

    function setFtsoFAssetFtsos(IIFtso _ftso, IIFtso[] memory _fAssetFtsos) external;

    function setFallbackMode(bool _fallbackMode) external;

    function setFtsoFallbackMode(IIFtso _ftso, bool _fallbackMode) external;
}
