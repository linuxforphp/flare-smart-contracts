// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/internal/IIFtso.sol";
import "../interfaces/user/IPriceSubmitter.sol";

interface IFtsoManager {

    event FtsoAdded(IIFtso ftso, bool add);
    event RewardEpochFinalized(uint256 votepowerBlock, uint256 startBlock);
    event PriceEpochFinalized(address chosenFtso, uint256 rewardEpochId);
    // TODO: Remove this event for production
    event KeepTrigger(uint256 blockNumber, uint256 timestamp);  // for monitoring keep() calls

    function activate() external;
    function deactivate() external;

    function priceSubmitter() external returns (IPriceSubmitter);

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

    function setFtsoFAsset(IIFtso _ftso, IFAsset _fAsset) external;
    function setFtsoFAssetFtsos(IIFtso _ftso, IIFtso[] memory _fAssetFtsos) external;

    function setPanicMode(bool _panicMode) external;
    function setFtsoPanicMode(IIFtso _ftso, bool _panicMode) external;

    function getCurrentRewardEpoch() external view returns (uint256);
    function getCurrentPriceEpochData() external view returns (
        uint256 _priceEpochId,
        uint256 _priceEpochStartTimestamp,
        uint256 _priceEpochEndTimestamp,
        uint256 _priceEpochRevealEndTimestamp,
        uint256 _currentTimestamp
    );
    function getFtsos() external view returns (IIFtso[] memory _ftsos);
    function getPriceEpochConfiguration() external view returns (
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSec,
        uint256 _revealEpochDurationSec
    );
}
