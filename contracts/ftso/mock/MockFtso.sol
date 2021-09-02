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
        address[] trustedAddresses;             // trusted addresses - set only when used
        bool fallbackMode;                      // current epoch in fallback mode
        bool rewardedFtso;                      // whether current epoch instance was a rewarded ftso
    }

    mapping (uint256 => EpochResult) private epochResults;
    
    constructor(
        string memory _symbol,
        IPriceSubmitter _priceSubmitter,
        IIVPToken _wNat,
        IIFtsoManager _ftsoManager,
        uint256 _startTimestamp,
        uint256 _submitPeriod,
        uint256 _revealPeriod,
        uint256 _initialPrice,
        uint256 _priceDeviationThresholdBIPS,
        uint256 _cyclicBufferSize
    )
        SimpleMockFtso(
            _symbol,
            _priceSubmitter,
            _wNat,
            _ftsoManager,
            _initialPrice,
            _priceDeviationThresholdBIPS,
            _cyclicBufferSize
        )
    {
        // Init only when sensible settings. Otherwise use mock similarly like Ftso.sol
        if (_submitPeriod != 0 && _revealPeriod != 0) {

            // configureEpochs
            epochs.maxVotePowerNatThresholdFraction = 1;
            epochs.maxVotePowerAssetThresholdFraction = 1;
            epochs.lowAssetUSDThreshold = 1000;
            epochs.highAssetUSDThreshold = 10000;
            epochs.highAssetTurnoutThresholdBIPS = 50;
            epochs.lowNatTurnoutThresholdBIPS = 1500;
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
        // used as a check only to avoid "Stack too deep" compiler error
        _getEpochInstance(_epochId);
        return _getFullEpochReport(_epochId);
    }

    function _getFullEpochReport(uint256 _epochId) 
        private view
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
        _epochSubmitStartTime = epochs._epochSubmitStartTime(_epochId);
        _epochSubmitEndTime = epochs._epochSubmitEndTime(_epochId);        
        _epochRevealEndTime = epochs._epochRevealEndTime(_epochId);
        _epochId = _epochId % priceEpochCyclicBufferSize;
        _price = epochs.instance[_epochId].price;
        _numberOfVotes = epochs.instance[_epochId].nextVoteIndex;
        _votePowerBlock = epochs.instance[_epochId].votePowerBlock;
        _finalizationType = epochs.instance[_epochId].finalizationType;
        _trustedAddresses = epochResults[_epochId].trustedAddresses;
        _fallbackMode = epochs.instance[_epochId].fallbackMode || epochResults[_epochId].fallbackMode;
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
     * @return _weightsNat          Array of native token weights in epoch
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
            uint256[] memory _weightsNat,
            uint256[] memory _weightsAsset,
            bool[] memory _eligibleForReward
        )
    {
        FtsoEpoch.Instance storage epoch = _getEpochInstance(_epochId);
        EpochResult storage epochResult = epochResults[_epochId % priceEpochCyclicBufferSize];

        uint256 count = epoch.nextVoteIndex;
        _voters = new address[](count);
        _prices = new uint256[](count);
        _weights = new uint256[](count);
        _weightsNat = new uint256[](count);
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
            _weightsNat[index] = vote.weightNat;
            _weightsAsset[index] = vote.weightAsset;
            _eligibleForReward[index] = rewardsAvailable && 
                vote.index >= firstEligibleForReward && vote.index <= lastEligibleForReward;
        }
        _weights = FtsoEpoch._computeWeights(epoch, _weightsNat, _weightsAsset);
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
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId % priceEpochCyclicBufferSize];
        EpochResult storage result = epochResults[_epochId % priceEpochCyclicBufferSize];

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
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId % priceEpochCyclicBufferSize];
        EpochResult storage result = epochResults[_epochId % priceEpochCyclicBufferSize];
        result.finalizedTimestamp = block.timestamp;
        result.trustedAddresses = epochs.trustedAddresses;
        result.fallbackMode = epoch.fallbackMode;
    }
}
