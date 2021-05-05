// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IFAsset.sol";
import "../user/IFtso.sol";

interface IIFtso is IFtso {

    /// function finalizePriceReveal
    /// called by reward manager only on correct timing.
    /// if price reveal period for epoch x ended. finalize.
    /// iterate list of price submissions
    /// find weighted median
    /// find adjucant 50% of price submissions.
    /// Allocate reward for any price submission which is same as a "winning" submission
    function finalizePriceEpoch(uint256 _epochId, bool _returnRewardData) external returns(
        address[] memory _eligibleAddresses,
        uint256[] memory _flrWeights,
        uint256 _totalFlrWeight
    );

    function forceFinalizePriceEpoch(uint256 _epochId) external;

    /// init price epoch data will be called by reward manager once epoch is added 
    /// before this init is done. FTSO can't run.
    function initializeEpochs(uint256 _firstEpochStartTs, uint256 _epochPeriod, uint256 _revealPeriod) external;

    function configureEpochs(
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

    function setFAsset(IFAsset _fAsset) external;

    function setFAssetFtsos(IIFtso[] memory _fAssetFtsos) external;

    // current vote power block will update per reward epoch. 
    // the FTSO doesn't have notion of reward epochs.
    // reward manager only can set this data. 
    function setVotePowerBlock(uint256 _blockNumber) external;

    // Returns current epoch id
    function initializeCurrentEpochStateForReveal() external returns (uint256);
  
    /**
     * @notice Returns the FTSO asset
     * @dev fAsset is null in case of multi-asset FTSO
     */
    function getFAsset() external view returns (IFAsset);

    /**
     * @notice Provides epoch summary
     * @param _epochId                  Id of the epoch
     * @return _epochSubmitStartTime    Start time of epoch price submission as seconds from unix epoch
     * @return _epochSubmitEndTime      End time of epoch price submission as seconds from unix epoch
     * @return _epochRevealStartTime    Start time of epoch price reveal as seconds from unix epoch
     * @return _epochRevealEndTime      End time of epoch price reveal as seconds from unix epoch
     * @return _price                   Finalized price for epoch
     * @return _lowRewardPrice          The lowest submitted price eligible for reward
     * @return _highRewardPrice         The highest submitted price eligible for reward
     * @return _numberOfVotes           Number of votes in epoch
     * @return _votePowerBlock          Block used for vote power inspection
     * @return _finalizationType        Finalization type for epoch
     * @return _trustedAddresses        Trusted addresses - set only if finalizationType equals 2 or 3
     * @return _rewardedFtso            Whether current epoch instance was a rewarded ftso
     */
    function getFullEpochReport(uint256 _epochId) external view returns (
        uint256 _epochSubmitStartTime,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealStartTime,
        uint256 _epochRevealEndTime,
        uint256 _price,
        uint256 _lowRewardPrice,
        uint256 _highRewardPrice,
        uint256 _numberOfVotes,
        uint256 _votePowerBlock,
        PriceFinalizationType _finalizationType,
        address[] memory _trustedAddresses,
        bool _rewardedFtso
    );
    
    /**
     * @notice Returns current configuration of epoch state
     * @return _minVotePowerFlrThreshold        Low threshold for FLR vote power per voter
     * @return _minVotePowerAssetThreshold      Low threshold for asset vote power per voter
     * @return _maxVotePowerFlrThreshold        High threshold for FLR vote power per voter
     * @return _maxVotePowerAssetThreshold      High threshold for FLR vote power per voter
     * @return _lowAssetUSDThreshold            Threshold for low asset vote power
     * @return _highAssetUSDThreshold           Threshold for high asset vote power
     * @return _highAssetTurnoutBIPSThreshold   Threshold for high asset turnout
     * @return _lowFlrTurnoutBIPSThreshold      Threshold for low flr turnout
     * @return _trustedAddresses                Trusted addresses - use their prices if low flr turnout is not achieved
     */
    function epochsConfiguration() external view returns (
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutBIPSThreshold,
        uint256 _lowFlrTurnoutBIPSThreshold,
        address[] memory _trustedAddresses
    );

    /**
     * @notice Provides summary of epoch votes
     * @param _epochId              Id of the epoch
     * @return _voters              Array of addresses an epoch price was submitted from
     * @return _prices              Array of prices submitted in epoch
     * @return _weights             Array of vote weights in epoch
     * @return _weightsFlr          Array of FLR weights in epoch
     * @return _weightsAsset        Array of asset weights in epoch
     * @return _eligibleForReward   Array of boolean values that specify which votes are eligible for reward
     * @notice Data for a single vote is determined by values in a specific position of the arrays
     */
    function getEpochVotes(uint256 _epochId) external view returns (
        address[] memory _voters,
        uint256[] memory _prices,
        uint256[] memory _weights,
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset,
        bool[] memory _eligibleForReward
    );

    /**
     * @notice Returns current epoch id
     */
    function getCurrentEpochId() external view returns (uint256);

    /**
     * @notice Returns id of the epoch which was opened for price submission at the specified timestamp
     * @param _timestamp            Timestamp as seconds from unix epoch
     */
    function getEpochId(uint256 _timestamp) external view returns (uint256);

    /**
     * @notice Returns random number of the specified epoch
     * @param _epochId              Id of the epoch
     */
    function getRandom(uint256 _epochId) external view returns (uint256);
    
    /**
     * @notice Returns FAsset price consented in specific epoch
     * @param _epochId              Id of the epoch
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getEpochPrice(uint256 _epochId) external view returns (uint256);
}
