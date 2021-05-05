// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IFAsset.sol";

interface IFtso {
    enum PriceFinalizationType {
        NOT_FINALIZED,
        MEDIAN,
        TRUSTED_ADDRESSES,
        PREVIOUS_PRICE_COPIED
    }

    // events
    event PriceSubmitted(
        address indexed submitter, uint256 indexed epochId, bytes32 hash, uint256 timestamp
    );
    event PriceRevealed(
        address indexed voter, uint256 indexed epochId, uint256 price, uint256 random, uint256 timestamp,
        uint256 votePowerFlr, uint256 votePowerAsset
    );
    event PriceFinalized(
        uint256 indexed epochId, uint256 price, bool rewardedFtso,
        uint256 lowRewardPrice, uint256 highRewardPrice, PriceFinalizationType finalizationType
    );
    event PriceEpochInitializedOnFtso(
        uint256 indexed epochId, uint256 endTime
    );

    /**
     * @notice Submits price hash for current epoch
     * @param _hash Hashed price and random number
     * @notice Emits PriceSubmitted event
     */
    function submitPrice(bytes32 _hash) external;

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
     * @return _timestamp               Timestamp as seconds from unix epoch
     */
    function getPriceEpochData() external view returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime,
        uint256 _timestamp
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
