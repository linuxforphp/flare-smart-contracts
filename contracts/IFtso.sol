// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./interfaces/IFAsset.sol";

interface IFtso {

    // events
    event PriceSubmitted(address indexed submitter, uint256 epochId);
    event PriceRevealed(
        address indexed voter, uint256 epochId, uint256 price, 
        uint256 votePowerFlr, uint256 votePowerAsset
    );
    event PriceFinalized(uint256 epochId, uint256 price, bool forced);
    event PriceEpochInitializedOnFtso(uint256 epochId, uint256 endTime);

    /// function finalizePriceReveal
    /// called by reward manager only on correct timing.
    /// if price reveal period for epoch x ended. finalize.
    /// iterate list of price submissions
    /// find weighted median
    /// find adjucant 50% of price submissions.
    /// Allocate reward for any price submission which is same as a "winning" submission
    function finalizePriceEpoch(uint256 epochId, bool returnRewardData) external returns(
        address[] memory eligibleAddresses,
        uint256[] memory flrWeights,
        uint256 totalFlrWeight
    );

    function forceFinalizePriceEpoch(uint256 epochId) external;

    /// init price epoch data will be called by reward manager once epoch is added 
    /// before this init is done. FTSO can't run.
    function initializeEpochs(uint256 firstEpochStartTs, uint256 epochPeriod, uint256 revealPeriod) external;

    function configureEpochs(
        uint256 _minVoteCount,
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThreshold
    ) external;

    function setFAssetFtsos(IFtso[] memory _fAssetFtsos) external;

    // current vote power block will update per reward epoch. 
    // the FTSO doesn't have notion of reward epochs.
    // reward manager only can set this data. 
    function setVotePowerBlock(uint256 blockNumber) external;

    function initializeCurrentEpochStateForReveal() external returns (uint256 currentEpochId);

    function epochsConfiguration() external view returns (
        uint256 minVoteCount,
        uint256 minVotePowerFlrThreshold,
        uint256 minVotePowerAssetThreshold,
        uint256 maxVotePowerFlrThreshold,
        uint256 maxVotePowerAssetThreshold,
        uint256 lowAssetUSDThreshold,
        uint256 highAssetUSDThreshold,
        uint256 highAssetTurnoutThreshold
    );

    function getFAsset() external view returns (IFAsset);

    /// function getRandom()
    /// per epoch all submitted random numbers should be accumulated
    /// when epoch finalized, hash this accumulation and save as last random number
    /// this API should return the result
    /// @param random is the random number
    /// TODO: consider returning randomTs = the time stamp this random was created.
    function getCurrentRandom() external view returns (uint256 random);

    /**
     * @notice Returns current epoch data
     * @return _epochId             Current epoch id
     * @return _epochSubmitEndTime  End time of the current epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime  End time of the current epoch price reveal as seconds from unix epoch
     */
    function getEpochData() external view returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime
    );

    function getPriceEpochConfiguration() external view returns (
        uint256 firstEpochStartTime,
        uint256 submitPeriod,
        uint256 revealPeriod
    );

    function getCurrentPrice() external view returns (uint256);
    function getEpochPrice(uint256 epochId) external view returns (uint256);
    function getEpochPriceForVoter(uint256 epochId, address voter) external view returns (uint256);
}
