// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library FtsoEpoch {

    struct State {

        // storage        
        mapping(uint256 => Instance) instance;
        mapping(uint256 => uint256) nextVoteId;
        
        // immutable settings
        uint256 firstEpochStartTime;
        uint256 submissionPeriod;
        uint256 revealPeriod;
        
        // configurable settings
        uint256 minVoteCount;
        uint256 maxVoteCount;
        uint256 votePowerBlock;
        uint256 minVotePowerFlrDenomination;    // value that determines if FLR vote power is sufficient to vote
        uint256 maxVotePowerFlrDenomination;    // value that determines what is the largest possible FLR vote power
        uint256 minVotePowerAssetDenomination;  // value that determines if asset vote power is sufficient to vote
        uint256 maxVotePowerAssetDenomination;  // value that determines what is the largest possible asset vote power
        uint256 lowAssetUSDThreshold;           // threshold for low asset vote power
        uint256 highAssetUSDThreshold;          // threshold for high asset vote power
        uint256 highAssetTurnoutThreshold;      // threshold for high asset turnout
    }

    struct Instance {                           // struct holding epoch votes and results
        uint256 votePowerBlock;                 // block used to obtain vote weights in epoch
        uint256 votePowerFlr;                   // total FLR vote power at votePowerBlock
        uint256 votePowerAsset;                 // total asset vote power at votePowerBlock
        uint256 minVotePowerFlr;                // min FLR vote power required for voting
        uint256 minVotePowerAsset;              // min asset vote power required for voting
        uint256 maxVotePowerFlr;                // max FLR vote power required for voting
        uint256 maxVotePowerAsset;              // max asset vote power required for voting
        uint256 accumulatedVotePowerFlr;        // total FLR vote power accumulated from votes in epoch
        uint256 accumulatedVotePowerAsset;      // total asset vote power accumulated from votes in epoch
        uint256 weightFlrSum;                   // sum of all FLR weights in epoch votes
        uint256 weightAssetSum;                 // sum of all asset weights in epoch votes
        uint256 firstVoteId;                    // id of the first vote in epoch
        uint256 truncatedFirstQuartileVoteId;   // first vote id eligible for reward
        uint256 firstQuartileVoteId;            // vote id corresponding to the first quartile
        uint256 medianVoteId;                   // vote id corresponding to the median
        uint256 lastQuartileVoteId;             // vote id corresponding to the last quartile
        uint256 truncatedLastQuartileVoteId;    // last vote id eligible for reward
        uint256 lastVoteId;                     // id of the last vote in epoch
        uint128 medianPrice;                    // consented epoch asset price
        uint256 lowRewardedPrice;               // the lowest submitted price eligible for reward
        uint256 highRewardedPrice;              // the highest submitted price elibible for reward
        uint256 lowWeightSum;                   // sum of (mixed) weights on votes with price too low for reward
        uint256 rewardedWeightSum;              // sum of (mixed) weights on votes eligible for reward
        uint256 highWeightSum;                  // sum of (mixed) weights on votes with price too high for reward
        uint256 flrLowWeightSum;                // sum of FLR weights on votes with price too low for reward
        uint256 flrRewardedWeightSum;           // sum of FLR weights on votes eligible for reward
        uint256 flrHighWeightSum;               // sum of FLR weights on votes with price too high for reward
        uint256 random;                         // random number associated with the epoch
        uint32 voteRewardCount;                 // number of votes in epoch eligible for the reward
        uint32 voteCount;                       // number of votes in epoch
        mapping(address => uint128) voterPrice; // price submitted by a voter in epoch 
    }

    uint256 internal constant MAX_UINT128 = 2**128 - 1;    

    /**
     * @dev Initializes a new epoch instance with instance specific settings
     * @param _state Epoch state
     * @param _instance Epoch instance
     * @param _votePowerFlr Epoch FLR vote power
     * @param _votePowerAsset Epoch asset vote power
     */
    function _initializeInstance(
        State storage _state,
        Instance storage _instance,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset
    ) internal
    {
        assert(_votePowerFlr <= MAX_UINT128);
        assert(_votePowerAsset <= MAX_UINT128);
        _instance.votePowerBlock = _state.votePowerBlock;
        _instance.votePowerFlr = _votePowerFlr;
        _instance.votePowerAsset = _votePowerAsset;
        _instance.minVotePowerFlr = _votePowerFlr / _state.minVotePowerFlrDenomination;
        _instance.minVotePowerAsset = _votePowerAsset / _state.minVotePowerAssetDenomination;
        _instance.maxVotePowerFlr = _votePowerFlr / _state.maxVotePowerFlrDenomination;
        _instance.maxVotePowerAsset = _votePowerAsset / _state.maxVotePowerAssetDenomination;
    }

    function _submitVote(
        State storage _state,
        Instance storage _instance,
        uint256 _voteId,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,        
        uint256 _random,
        uint128 _price
    ) internal
    {
        if (_instance.voteCount == 0) {
            // first vote in epoch instance
            _instance.firstVoteId = _voteId;
            _instance.lastVoteId = _voteId;
            _instance.voteCount = 1;
        } else {
            // epoch instance already contains votes, add the new one to the list
            _state.nextVoteId[_instance.lastVoteId] = _voteId;
            _instance.lastVoteId = _voteId;
            _instance.voteCount += 1;
        }
        _instance.accumulatedVotePowerFlr += _votePowerFlr;
        _instance.accumulatedVotePowerAsset += _votePowerAsset;
        _instance.random += _random;
        _instance.voterPrice[msg.sender] = _price;
    }

    function _getEpochId(State storage _state, uint256 timestamp) internal view returns (uint256) {
        return (timestamp - _state.firstEpochStartTime) / _state.submissionPeriod;
    }

    function _epochEndTime(State storage _state, uint256 _epochId) internal view returns (uint256) {
        return _state.firstEpochStartTime + (_epochId + 1) * _state.submissionPeriod;
    }

    function _epochRevealInProcess(State storage _state, uint256 _epochId) internal view returns (bool) {
        uint256 endTime = _epochEndTime(_state, _epochId);
        return endTime < block.timestamp && block.timestamp <= endTime + _state.revealPeriod;
    }

    function _getWeightRatio(
        State storage _state,
        Instance storage _instance,
        uint128 _assetPriceUSD
    ) internal view returns (uint256)
    {
        uint256 votePowerUSD = _instance.votePowerAsset * _assetPriceUSD;
        
        uint256 baseWeightRatio;
        if (votePowerUSD <= _state.lowAssetUSDThreshold) {
            baseWeightRatio = 50;
        } else if (votePowerUSD >= _state.highAssetUSDThreshold) {
            baseWeightRatio = 500;
        } else {
            baseWeightRatio = (450 * (votePowerUSD - _state.lowAssetUSDThreshold)) /
                (_state.highAssetUSDThreshold - _state.lowAssetUSDThreshold) + 50;
        }

        uint256 weightRatio;
        uint256 turnout = (1000 * _instance.accumulatedVotePowerAsset) / _instance.votePowerAsset;
        if (turnout >= _state.highAssetTurnoutThreshold) {
            weightRatio = baseWeightRatio;
        } else {
            weightRatio = (baseWeightRatio * turnout) / _state.highAssetTurnoutThreshold;
        }

        return weightRatio;
    }

}