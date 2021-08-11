// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IFtso.sol";
import "../../token/interface/IIVPToken.sol";


interface IIFtso is IFtso {

    /**
     * @notice Submits price hash for current epoch - only price submitter
     * @param _sender               Sender address
     * @param _hash                 Hashed price and random number
     * @return _epochId             Returns current epoch id
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHashSubmitter(address _sender, bytes32 _hash) external returns (uint256 _epochId);

    /**
     * @notice Reveals submitted price during epoch reveal period - only price submitter
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPriceSubmitter(
        address _voter,
        uint256 _epochId,
        uint256 _price,
        uint256 _random,
        uint256 _wflrVP
    ) external;

    /// function finalizePriceReveal
    /// called by reward manager only on correct timing.
    /// if price reveal period for epoch x ended. finalize.
    /// iterate list of price submissions
    /// find weighted median
    /// find adjucant 50% of price submissions.
    /// Allocate reward for any price submission which is same as a "winning" submission
    function finalizePriceEpoch(uint256 _epochId, bool _returnRewardData) external
        returns(
            address[] memory _eligibleAddresses,
            uint256[] memory _flrWeights,
            uint256 _totalFlrWeight
        );

    function averageFinalizePriceEpoch(uint256 _epochId) external;

    function forceFinalizePriceEpoch(uint256 _epochId) external;

    // activateFtso will be called by ftso manager once ftso is added 
    // before this is done, FTSO can't run
    function activateFtso(
        address _priceSubmitter, // hardhat flatten does not allow cyclic imports, do this outside typesystem
        uint256 _firstEpochStartTs,
        uint256 _epochPeriod,
        uint256 _revealPeriod
    ) external;

    function deactivateFtso() external;

    // update initial price and timestamp - only if not active
    function updateInitialPrice(uint256 _initialPriceUSD, uint256 _initialPriceTimestamp) external;

    function configureEpochs(
        uint256 _maxVotePowerFlrThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowFlrTurnoutThresholdBIPS,
        address[] memory _trustedAddresses
    ) external;

    function setFAsset(IIVPToken _fAsset) external;

    function setFAssetFtsos(IIFtso[] memory _fAssetFtsos) external;

    // current vote power block will update per reward epoch. 
    // the FTSO doesn't have notion of reward epochs.
    // reward manager only can set this data. 
    function setVotePowerBlock(uint256 _blockNumber) external;

    function initializeCurrentEpochStateForReveal(bool _fallbackMode) external;
    
    function flrVotePowerCached(address _owner, uint256 _epochId) external returns (uint256);
  
    /**
     * @notice Returns the FTSO asset
     * @dev fAsset is null in case of multi-asset FTSO
     */
    function getFAsset() external view returns (IIVPToken);

    /**
     * @notice Returns the FAsset FTSOs
     * @dev FAssetFtsos is not null only in case of multi-asset FTSO
     */
    function getFAssetFtsos() external view returns (IIFtso[] memory);

    /**
     * @notice Returns current configuration of epoch state
     * @return _maxVotePowerFlrThresholdFraction        High threshold for FLR vote power per voter
     * @return _maxVotePowerAssetThresholdFraction      High threshold for FLR vote power per voter
     * @return _lowAssetUSDThreshold            Threshold for low asset vote power
     * @return _highAssetUSDThreshold           Threshold for high asset vote power
     * @return _highAssetTurnoutThresholdBIPS   Threshold for high asset turnout
     * @return _lowFlrTurnoutThresholdBIPS      Threshold for low flr turnout
     * @return _trustedAddresses                Trusted addresses - use their prices if low flr turnout is not achieved
     */
    function epochsConfiguration() external view 
        returns (
            uint256 _maxVotePowerFlrThresholdFraction,
            uint256 _maxVotePowerAssetThresholdFraction,
            uint256 _lowAssetUSDThreshold,
            uint256 _highAssetUSDThreshold,
            uint256 _highAssetTurnoutThresholdBIPS,
            uint256 _lowFlrTurnoutThresholdBIPS,
            address[] memory _trustedAddresses
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

    /**
     * @notice Returns parameters necessary for approximately replicating vote weighting.
     * @return _assets                  the list of fAssets that are accounted in vote
     * @return _assetMultipliers        weight of each asset in (multiasset) ftso, mutiplied by TERA
     * @return _totalVotePowerFlr       total FLR vote power at block
     * @return _totalVotePowerAsset     total combined asset vote power at block
     * @return _assetWeightRatio        ratio of combined asset vp vs. FLR vp (in BIPS)
     * @return _votePowerBlock          vote powewr block for given epoch
     */
    function getVoteWeightingParameters() external view 
        returns (
            IIVPToken[] memory _assets,
            uint256[] memory _assetMultipliers,
            uint256 _totalVotePowerFlr,
            uint256 _totalVotePowerAsset,
            uint256 _assetWeightRatio,
            uint256 _votePowerBlock
        );

    function wFlr() external view returns (IIVPToken);
}
