// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IVotePower.sol";
// import "hardhat/console.sol";
/**
 * @title A library used for FTSO epoch management
 */
library FtsoEpoch {

    struct State {                              // struct holding storage and settings related to epochs

        // storage        
        mapping(uint256 => Instance) instance;  // mapping from epoch id to instance
        mapping(uint256 => uint256) nextVoteId; // mapping from id to id storing the connection between votes in epoch
        
        // immutable settings
        uint256 firstEpochStartTime;            // start time of the first epoch instance
        uint256 submitPeriod;                   // duration of price submission for an epoch instance
        uint256 revealPeriod;                   // duration of price reveal for an apoch instance
        
        // configurable settings
        uint256 minVoteCount;                   // minimal number of votes required in epoch
        uint256 votePowerBlock;                 // current block at which the vote power is checked
        uint256 minVotePowerFlrThreshold;       // low threshold for FLR vote power per voter
        uint256 minVotePowerAssetThreshold;     // low threshold for asset vote power per voter
        uint256 maxVotePowerFlrThreshold;       // high threshold for FLR vote power per voter
        uint256 maxVotePowerAssetThreshold;     // high threshold for asset vote power per voter
        uint256 lowAssetUSDThreshold;           // threshold for low asset vote power (in scaled USD)
        uint256 highAssetUSDThreshold;          // threshold for high asset vote power (in scaled USD)
        uint256 highAssetTurnoutThreshold;      // threshold for high asset turnout (in vote power units)
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
        uint256 baseWeightRatio;                // base weight ratio between asset and FLR used to combine weights
        uint256 weightRatio;                    // weight ratio between asset and FLR used to combine weights
        uint256 firstVoteId;                    // id of the first vote in epoch
        uint256 truncatedFirstQuartileVoteId;   // first vote id eligible for reward
        uint256 firstQuartileVoteId;            // vote id corresponding to the first quartile
        uint256 medianVoteId;                   // vote id corresponding to the median
        uint256 lastQuartileVoteId;             // vote id corresponding to the last quartile
        uint256 truncatedLastQuartileVoteId;    // last vote id eligible for reward
        uint256 lastVoteId;                     // id of the last vote in epoch
        uint256 medianPrice;                    // consented epoch asset price
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
        bool initializedForReveal;              // whether epoch instance is initialized for reveal
        IVotePower[] assets;                    // list of assets
        uint256[] assetWeightedPrices;          // prices that determine the contributions of assets to vote power
        mapping(address => uint256) voterPrice; // price submitted by a voter in epoch 
    }

    uint256 internal constant MAX_UINT128 = 2**128 - 1;         // max number in uint128
    uint256 internal constant MAX_UINT104 = 2**104 - 1;         // max number in uint104
    uint256 internal constant BIPS100 = 1e4;                    // 100% in basis points
    uint256 internal constant BIPS50 = BIPS100 / 2;             // 50% in basis points
    uint256 internal constant BIPS45 = (45 * BIPS100) / 100;    // 45% in basis points
    uint256 internal constant BIPS5 = (5 * BIPS100) / 100;      // 5% in basis points

    /**
     * @notice Initializes a new epoch instance with instance specific settings
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _votePowerFlr         Epoch FLR vote power
     * @param _assets               List of assets
     * @param _assetVotePowers      List of asset vote powers
     * @param _assetPrices          List of asset prices
     * @dev _votePowerFlr is assumed to be smaller than 2**128 to avoid overflows in computations
     * @dev computed votePowerAsset is assumed to be smaller than 2**128 to avoid overflows in computations
     */
    function _initializeInstance(
        State storage _state,
        Instance storage _instance,
        uint256 _votePowerFlr,
        IVotePower[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) internal
    {    
        // TODO: check somewhere that we never divide with 0  
        _setAssets(_state, _instance, _assets, _assetVotePowers, _assetPrices);
        _instance.votePowerBlock = _state.votePowerBlock;
        _instance.votePowerFlr = _votePowerFlr;
        _instance.minVotePowerFlr = _votePowerFlr / _state.minVotePowerFlrThreshold;
        _instance.minVotePowerAsset = _instance.votePowerAsset / _state.minVotePowerAssetThreshold;
        _instance.maxVotePowerFlr = _votePowerFlr / _state.maxVotePowerFlrThreshold;
        _instance.maxVotePowerAsset = _instance.votePowerAsset / _state.maxVotePowerAssetThreshold;
    }

    /**
     * @notice Adds a vote to the linked list representing an epoch instance
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _voteId               Id of the vote to add
     * @param _votePowerFlr         Vote power for FLR
     * @param _votePowerAsset       Vote power for asset
     * @param _random               Random number associated with the vote
     * @param _price                Price associated with the vote
     */
    function _addVote(
        State storage _state,
        Instance storage _instance,
        uint256 _voteId,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,
        uint256 _random,
        uint256 _price
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

    /**
     * @notice Returns the id of the epoch opened for price submission at the given timestamp
     * @param _state                Epoch state
     * @param _timestamp            Timestamp as seconds since unix epoch
     * @return Epoch id
     */
    function _getEpochId(State storage _state, uint256 _timestamp) internal view returns (uint256) {
        return (_timestamp - _state.firstEpochStartTime) / _state.submitPeriod;
    }

    /**
     * @notice Returns start time of price submission for an epoch instance
     * @param _state                Epoch state
     * @param _epochId              Id of epoch instance
     * @return Timestamp as seconds since unix epoch
     */
    function _epochSubmitStartTime(State storage _state, uint256 _epochId) internal view returns (uint256) {
        return _state.firstEpochStartTime + _epochId * _state.submitPeriod;
    }

    /**
     * @notice Returns end time of price submission for an epoch instance
     * @param _state                Epoch state
     * @param _epochId              Id of epoch instance
     * @return Timestamp as seconds since unix epoch
     */
    function _epochSubmitEndTime(State storage _state, uint256 _epochId) internal view returns (uint256) {
        return _state.firstEpochStartTime + (_epochId + 1) * _state.submitPeriod;
    }

    /**
     * @notice Returns end time of price reveal for an epoch instance
     * @param _state                Epoch state
     * @param _epochId              Id of epoch instance
     * @return Timestamp as seconds since unix epoch
     */
    function _epochRevealEndTime(State storage _state, uint256 _epochId) internal view returns (uint256) {
        return _epochSubmitEndTime(_state, _epochId) + _state.revealPeriod;
    }

    /**
     * @notice Determines if the epoch with the given id is currently in the reveal process
     * @param _state                Epoch state
     * @param _epochId              Id of epoch
     * @return True if epoch reveal is in process and false otherwise
     */
    function _epochRevealInProcess(State storage _state, uint256 _epochId) internal view returns (bool) {
        uint256 endTime = _epochSubmitEndTime(_state, _epochId);
        return endTime < block.timestamp && block.timestamp <= endTime + _state.revealPeriod;
    }

    /**
     * @notice Sets epoch instance data related to assets
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _assets               List of assets
     * @param _assetVotePowers      List of asset vote powers
     * @param _assetPrices          List of asset prices
     */
    function _setAssets(
        State storage _state,
        Instance storage _instance,
        IVotePower[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) internal
    {
        _instance.assets = _assets;
        uint256 count = _assets.length;

        // compute sum of vote powers in USD
        uint256 votePowerSumUSD = 0;
        for (uint256 i = 0; i < count; i++) {
            assert(_assetVotePowers[i] < MAX_UINT104);
            assert(_assetPrices[i] < MAX_UINT128);
            votePowerSumUSD += _assetVotePowers[i] * _assetPrices[i];
        }

        // determine asset weighted prices
        uint256[] memory weightedPrices = new uint256[](count);
        if (votePowerSumUSD > 0) {
            // determine shares based on asset vote powers in USD
            for (uint256 i = 0; i < count; i++) {
                uint256 share = (_assetVotePowers[i] * _assetPrices[i] * BIPS100) / votePowerSumUSD;
                weightedPrices[i] = share * _assetPrices[i];
            }
        } else {
            // consider assets equally
            uint256 share = BIPS100 / count;
            for (uint256 i = 0; i < count; i++) {
                weightedPrices[i] = share * _assetPrices[i];
            }
        }
        _instance.assetWeightedPrices = weightedPrices;

        // compute vote power
        uint256 votePowerUSD = 0;
        for (uint256 i = 0; i < count; i++) {
            votePowerUSD += (weightedPrices[i] * _assetVotePowers[i]) / BIPS100;
        }
        _instance.votePowerAsset = votePowerUSD;

        // compute base weight ratio between asset and FLR
        _instance.baseWeightRatio = _getAssetBaseWeightRatio(_state, votePowerUSD);
    }

    /**
     * @notice Computes the base asset weight ratio
     * @param _state                Epoch state
     * @param _assetVotePowerUSD    Price of the asset in USD
     * @return Base weight ratio for asset in BIPS (a number between 0 and BIPS)
     */
    function _getAssetBaseWeightRatio(
        State storage _state,
        uint256 _assetVotePowerUSD
    ) internal view returns (uint256)
    {        
        uint256 ratio;
        if (_assetVotePowerUSD < _state.lowAssetUSDThreshold) {
            // 0 %
            ratio = 0;
        } else if (_assetVotePowerUSD >= _state.highAssetUSDThreshold) {
            // 50 %
            ratio = BIPS50;
        } else {
            // between 5% and 50% (linear function)
            ratio = (BIPS45 * (_assetVotePowerUSD - _state.lowAssetUSDThreshold)) /
                (_state.highAssetUSDThreshold - _state.lowAssetUSDThreshold) + BIPS5;
        }
        return ratio;
    }

    /**
     * @notice Computes the weight ratio between FLR and asset weight that specifies a unified vote weight
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @return Weight ratio for asset in BIPS (a number between 0 and BIPS)
     * @dev Weight ratio for FLR is supposed to be (BIPS - weight ratio for asset)
     */
    function _getWeightRatio(
        State storage _state,
        Instance storage _instance
    ) internal view returns (uint256)
    {
        if (_instance.votePowerAsset == 0) {
            return 0;
        }
        uint256 turnout = (BIPS100 * _instance.accumulatedVotePowerAsset) / _instance.votePowerAsset;
        if (turnout >= _state.highAssetTurnoutThreshold) {
            return _instance.baseWeightRatio;
        } else {
            return (_instance.baseWeightRatio * turnout) / _state.highAssetTurnoutThreshold;
        }
    }

    /**
     * @notice Computes vote weights in epoch
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _weightsFlr           Array of FLR weights
     * @param _weightsAsset         Array of asset weights
     * @param _weightsFlrSum        Sum of all FLR weights
     * @param _weightsAssetSum      Sum of all asset weights
     * @return _weights              Array of combined weights
     * @return _weightRatio         Weight ratio used to combine FLR and asset weights
     * @dev All parameters and variables are in BIPS
     */
    function computeWeights(
        FtsoEpoch.State storage _state,
        FtsoEpoch.Instance storage _instance,
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset,
        uint256 _weightsFlrSum,
        uint256 _weightsAssetSum
    ) internal view returns (uint256[] memory _weights, uint256 _weightRatio)
    {
        _weights = new uint256[](_instance.voteCount);
        if (_weightsAssetSum == 0) {
            // no votes with asset vote power present, use FLR weights
            for (uint256 i = 0; i < _instance.voteCount; i++) {
                _weights[i] = _weightsFlr[i];
            }
        } else if (_weightsFlrSum == 0) {
            // no votes with FLR vote power present, use asset weights
            for (uint256 i = 0; i < _instance.voteCount; i++) {
                _weights[i] = _weightsAsset[i];
            }
        } else {
            // combine FLR and asset weight
            _weightRatio = _getWeightRatio(_state, _instance);
            uint256 flrShare = ((BIPS100 - _weightRatio) * _weightsAssetSum) / BIPS100;
            uint256 assetShare = (_weightRatio * _weightsFlrSum) / BIPS100;            
            for (uint32 i = 0; i < _instance.voteCount; i++) {
                _weights[i] = (flrShare * _weightsFlr[i] + assetShare * _weightsAsset[i]) / BIPS100;
            }
        }
    }

    /**
     * @dev Consider incorporating this logic into computeWeights to avoid code duplication
     */
    function _getWeight(
        FtsoEpoch.Instance storage _instance,
        uint256 _weightFlr,
        uint256 _weightAsset
    ) internal view returns (uint256) {
        uint256 weight;
        if (_instance.weightAssetSum == 0) {
            weight = _weightFlr;
        } else if (_instance.weightAssetSum == 0) {
            weight = _weightAsset;
        } else {
            // combine FLR and asset weight
            uint256 weightRatio = _instance.weightRatio;
            uint256 flrShare = ((BIPS100 - weightRatio) * _instance.weightAssetSum) / BIPS100;
            uint256 assetShare = (weightRatio * _instance.weightFlrSum) / BIPS100;            
            for (uint32 i = 0; i < _instance.voteCount; i++) {
                weight = (flrShare * _weightFlr + assetShare * _weightAsset) / BIPS100;
            }
        }
        return weight;
    }

}
