// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./SimpleMockFtso.sol";


contract MockFtso is SimpleMockFtso {
    using FtsoEpoch for FtsoEpoch.State;
    
    struct EpochResult {
        uint256 truncatedFirstQuartileIndex;    // first vote id eligible for reward
        uint256 truncatedLastQuartileIndex;     // last vote id eligible for reward
        uint256 lowRewardedPrice;               // the lowest submitted price eligible for reward
        uint256 highRewardedPrice;              // the highest submitted price eligible for reward
        uint256 finalizedTimestamp;             // block.timestamp of time when price is decided
        bool rewardedFtso;                      // whether current epoch instance was a rewarded ftso
    }

    mapping (uint256 => EpochResult) private epochResults;
    
    constructor(
        string memory _symbol,
        IIVPToken _wFlr,
        IIFtsoManager _ftsoManager,
        IISupply _supply,
        uint256 _startTimestamp,
        uint256 _submitPeriod,
        uint256 _revealPeriod,
        uint256 _initialPrice,
        uint256 _priceDeviationThresholdBIPS
    )
        SimpleMockFtso(_symbol, _wFlr, _ftsoManager, _supply, _initialPrice, _priceDeviationThresholdBIPS)
    {
        // Init only when sensible settings. Otherwise use mock similarly like Ftso.sol
        if (_submitPeriod != 0 && _revealPeriod != 0) {

            // configureEpochs
            epochs.maxVotePowerFlrThresholdFraction = 1;
            epochs.maxVotePowerAssetThresholdFraction = 1;
            epochs.lowAssetUSDThreshold = 1000;
            epochs.highAssetUSDThreshold = 10000;
            epochs.highAssetTurnoutThresholdBIPS = 50;
            epochs.lowFlrTurnoutThresholdBIPS = 1500;
            epochs.trustedAddresses = new address[](0);

            // activateFtso
            epochs.firstEpochStartTime = _startTimestamp;
            epochs.submitPeriod = _submitPeriod;
            epochs.revealPeriod = _revealPeriod;
            active = true;
        }
    }

    /**
     * @notice Provides epoch summary
     * @param _epochId                  Id of the epoch
     * @return _epochSubmitStartTime    Start time of epoch price submission as seconds from unix epoch
     * @return _epochSubmitEndTime      End time of epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime      End time of epoch price reveal as seconds from unix epoch
     * @return _epochFinalizedTimestamp Block.timestamp when the price was decided
     * @return _price                   Finalized price for epoch
     * @return _lowRewardPrice          The lowest submitted price eligible for reward
     * @return _highRewardPrice         The highest submitted price eligible for reward
     * @return _numberOfVotes           Number of votes in epoch
     * @return _votePowerBlock          Block used for vote power inspection
     * @return _finalizationType        Finalization type for epoch
     * @return _trustedAddresses        Trusted addresses - set only if finalizationType equals 2 or 3
     * @return _rewardedFtso            Whether epoch instance was a rewarded ftso
     * @return _fallbackMode            Whether epoch instance was in fallback mode
     * @dev half-closed intervals - end time not included
     */
    function getFullEpochReport(uint256 _epochId) 
        public view
        returns (
            uint256 _epochSubmitStartTime,
            uint256 _epochSubmitEndTime,
            uint256 _epochRevealEndTime,
            uint256 _epochFinalizedTimestamp,
            uint256 _price,
            uint256 _lowRewardPrice,
            uint256 _highRewardPrice,
            uint256 _numberOfVotes,
            uint256 _votePowerBlock,
            PriceFinalizationType _finalizationType,
            address[] memory _trustedAddresses,
            bool _rewardedFtso,
            bool _fallbackMode
        )
    {
        require(_epochId <= getCurrentEpochId(), ERR_EPOCH_UNKNOWN);
        _epochSubmitStartTime = epochs._epochSubmitStartTime(_epochId);
        _epochSubmitEndTime = epochs._epochSubmitEndTime(_epochId);        
        _epochRevealEndTime = epochs._epochRevealEndTime(_epochId);
        _price = epochs.instance[_epochId].price;
        _numberOfVotes = epochs.instance[_epochId].votes.length;
        _votePowerBlock = epochs.instance[_epochId].votePowerBlock;
        _finalizationType = epochs.instance[_epochId].finalizationType;
        _trustedAddresses = epochs.instance[_epochId].trustedAddresses;
        _fallbackMode = epochs.instance[_epochId].fallbackMode;
        _epochFinalizedTimestamp = epochResults[_epochId].finalizedTimestamp;
        _lowRewardPrice = epochResults[_epochId].lowRewardedPrice;
        _highRewardPrice = epochResults[_epochId].highRewardedPrice;
        _rewardedFtso = epochResults[_epochId].rewardedFtso;
    }

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
    function getEpochVotes(uint256 _epochId)
        public view
        returns (
            address[] memory _voters,
            uint256[] memory _prices,
            uint256[] memory _weights,
            uint256[] memory _weightsFlr,
            uint256[] memory _weightsAsset,
            bool[] memory _eligibleForReward
        )
    {
        require(_epochId <= getCurrentEpochId(), ERR_EPOCH_UNKNOWN);

        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        EpochResult storage epochResult = epochResults[_epochId];

        uint256 count = epoch.votes.length;
        _voters = new address[](count);
        _prices = new uint256[](count);
        _weights = new uint256[](count);
        _weightsFlr = new uint256[](count);
        _weightsAsset = new uint256[](count);
        _eligibleForReward = new bool[](count);

        uint256 firstEligibleForReward = epochResult.truncatedFirstQuartileIndex;
        uint256 lastEligibleForReward = epochResult.truncatedLastQuartileIndex;
        bool rewardsAvailable = epoch.finalizationType == PriceFinalizationType.WEIGHTED_MEDIAN;
        for (uint256 i = 0; i < count; i++) {
            FtsoVote.Instance storage vote = epoch.votes[i];
            uint256 index = vote.index; // make sure the result is sorted
            _voters[index] = vote.voter;
            _prices[index] = vote.price;
            _weightsFlr[index] = vote.weightFlr;
            _weightsAsset[index] = vote.weightAsset;
            _eligibleForReward[index] = rewardsAvailable && 
                vote.index >= firstEligibleForReward && vote.index <= lastEligibleForReward;
        }
        _weights = FtsoEpoch._computeWeights(epoch, _weightsFlr, _weightsAsset);
    }

    /**
     * @notice Stores epoch data related to price
     * @param _epochId              Epoch instance
     * @param _data                 Median computation data
     * @param _index                Array of vote indices
     */
    function _writeEpochPriceData(
        uint256 _epochId,
        FtsoMedian.Data memory _data, 
        uint256[] memory _index,
        bool rewardedFtso
    )
        internal virtual override
    {
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        EpochResult storage result = epochResults[_epochId];
        
        // update indexes
        for (uint256 i = 0; i < _index.length; i++) {
            epoch.votes[_index[i]].index = uint32(i);
        }

        // store data
        result.truncatedFirstQuartileIndex = _data.quartile1Index;
        result.truncatedLastQuartileIndex = _data.quartile3Index;
        result.lowRewardedPrice = _data.quartile1Price;
        result.highRewardedPrice = _data.quartile3Price;
        result.finalizedTimestamp = block.timestamp;
        result.rewardedFtso = rewardedFtso;
    }

    /**
     * @notice Stores epoch data related to price (fallback / low turnout / forced mode)
     * To be implemented in descendants
     */
    function _writeFallbackEpochPriceData(uint256 _epochId) internal virtual override {
        EpochResult storage result = epochResults[_epochId];
        result.finalizedTimestamp = block.timestamp;
    }
}
