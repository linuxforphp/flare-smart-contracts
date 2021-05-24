// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IFtso {
    enum PriceFinalizationType {
        // initial state
        NOT_FINALIZED,
        // median calculation used to decide price
        MEDIAN,
        // low turnout - price decided from average of trusted addresses
        TRUSTED_ADDRESSES,
        // low turnout + no votes from trusted addresses - price copied from previous epoch
        PREVIOUS_PRICE_COPIED,
        // price decided from average of trusted addresses - triggered due to an exception
        TRUSTED_ADDRESSES_EXCEPTION,
        // previous price copied - triggered due to an exception
        PREVIOUS_PRICE_COPIED_EXCEPTION
    }

    // events
    event PriceHashSubmitted(
        address indexed submitter, uint256 indexed epochId, bytes32 hash, uint256 timestamp
    );
    event PriceRevealed(
        address indexed voter, uint256 indexed epochId, uint256 price, uint256 random, uint256 timestamp,
        uint256 votePowerFlr, uint256 votePowerAsset
    );
    event PriceFinalized(
        uint256 indexed epochId, uint256 price, bool rewardedFtso,
        uint256 lowRewardPrice, uint256 highRewardPrice, PriceFinalizationType finalizationType,
        uint256 timestamp
    );
    event PriceEpochInitializedOnFtso(
        uint256 indexed epochId, uint256 endTime, uint256 timestamp
    );

    event LowTurnout(
        uint256 indexed epochId,
        uint256 flrTurnout,
        uint256 lowFlrTurnoutBIPSThreshold,
        uint256 timestamp
    );

    /**
     * @notice Submits price hash for current epoch
     * @param _hash Hashed price and random number
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHash(bytes32 _hash) external;

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) external;
    
    /**
     * @notice Returns if FTSO is active
     */
    function active() external view returns (bool);

    /**
     * @notice Returns the FTSO symbol
     */
    function symbol() external view returns (string memory);

    /**
     * @notice Returns current epoch data
     * @return _epochId                 Current epoch id
     * @return _epochSubmitEndTime      End time of the current epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime      End time of the current epoch price reveal as seconds from unix epoch
     * @return _votePowerBlock          Vote power block for the current epoch
     * @return _minVotePowerFlr         Minimal vote power for WFLR (in WFLR) for the current epoch
     * @return _minVotePowerAsset       Minimal vote power for FAsset (in scaled USD) for the current epoch
     * @return _fallbackMode            Current epoch in fallback mode - only votes from trusted addresses will be used
     */
    function getPriceEpochData() external view returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime,
        uint256 _votePowerBlock,
        uint256 _minVotePowerFlr,
        uint256 _minVotePowerAsset,
        bool _fallbackMode
    );

    /**
     * @notice Returns current epoch data
     * @return _firstEpochStartTime         First epoch start time
     * @return _submitPeriod                Submit period in seconds
     * @return _revealPeriod                Reveal period in seconds
     */
    function getPriceEpochConfiguration() external view returns (
        uint256 _firstEpochStartTime,
        uint256 _submitPeriod,
        uint256 _revealPeriod
    );
    
    /**
     * @notice Returns FAsset price submitted by voter in specific epoch
     * @param _epochId              Id of the epoch
     * @param _voter                Address of the voter
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external view returns (uint256);

    /**
     * @notice Returns current FAsset price
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getCurrentPrice() external view returns (uint256);

    /**
     * @notice Returns current random number
     */
    function getCurrentRandom() external view returns (uint256);
}
