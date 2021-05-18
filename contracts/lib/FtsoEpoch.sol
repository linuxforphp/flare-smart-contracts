// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IFAsset.sol";
import "../interfaces/user/IFtso.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./SafePct.sol";
// import "hardhat/console.sol";

/**
 * @title A library used for FTSO epoch management
 */
library FtsoEpoch {
    using SafeMath for uint256;
    using SafePct for uint256;

    struct State {                              // struct holding storage and settings related to epochs

        // storage        
        mapping(uint256 => Instance) instance;  // mapping from epoch id to instance
        mapping(uint256 => uint256) nextVoteId; // mapping from id to id storing the connection between votes in epoch
        mapping(IFAsset => uint256) assetNorm;  // mapping from asset address to its normalization

        // immutable settings
        uint256 firstEpochStartTime;            // start time of the first epoch instance
        uint256 submitPeriod;                   // duration of price submission for an epoch instance
        uint256 revealPeriod;                   // duration of price reveal for an apoch instance
        
        // configurable settings
        uint256 votePowerBlock;                 // current block at which the vote power is checked
        uint256 minVotePowerFlrThreshold;       // low threshold for FLR vote power per voter
        uint256 minVotePowerAssetThreshold;     // low threshold for asset vote power per voter
        uint256 maxVotePowerFlrThreshold;       // high threshold for FLR vote power per voter
        uint256 maxVotePowerAssetThreshold;     // high threshold for asset vote power per voter
        uint256 lowAssetUSDThreshold;           // threshold for low asset vote power (in scaled USD)
        uint256 highAssetUSDThreshold;          // threshold for high asset vote power (in scaled USD)
        uint256 highAssetTurnoutBIPSThreshold;  // threshold for high asset turnout (in BIPS)
        uint256 lowFlrTurnoutBIPSThreshold;     // threshold for low flr turnout (in BIPS)
        address[] trustedAddresses;             // trusted addresses - use their prices if low turnout is not achieved
        mapping(address => bool) trustedAddressesMapping; // for checking addresses in panic mode
    }

    struct Instance {                           // struct holding epoch votes and results
        
        uint256 votePowerBlock;                 // block used to obtain vote weights in epoch
        uint256 highAssetTurnoutBIPSThreshold;  // threshold for high asset turnout (in BIPS)
        uint256 lowFlrTurnoutBIPSThreshold;     // threshold for low flr turnout (in BIPS)
        uint256 circulatingSupplyFlr;           // total FLR circulating supply at votePowerBlock
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
        uint256 firstVoteId;                    // id of the first vote in epoch
        uint256 truncatedFirstQuartileVoteId;   // first vote id eligible for reward
        uint256 truncatedLastQuartileVoteId;    // last vote id eligible for reward
        uint256 lastVoteId;                     // id of the last vote in epoch
        uint256 price;                          // consented epoch asset price
        IFtso.PriceFinalizationType finalizationType; // finalization type
        uint256 lowRewardedPrice;               // the lowest submitted price eligible for reward
        uint256 highRewardedPrice;              // the highest submitted price elibible for reward
        uint256 random;                         // random number associated with the epoch
        uint256 voteCount;                       // number of votes in epoch
        IFAsset[] assets;                       // list of assets
        uint256[] assetWeightedPrices;          // prices that determine the contributions of assets to vote power
        mapping(address => uint256) votes;      // address to vote id mapping
        address[] trustedAddresses;             // trusted addresses - set only when used
        uint256 finalizedTimestamp;             // block.timestamp of time when price is decided
        bool initializedForReveal;              // whether epoch instance is initialized for reveal
        bool rewardedFtso;                      // whether current epoch instance was a rewarded ftso
        bool panicMode;                         // current epoch in panic mode
    }

    uint256 internal constant BIPS100 = 1e4;                    // 100% in basis points
    uint256 internal constant BIPS50 = BIPS100 / 2;             // 50% in basis points
    uint256 internal constant BIPS45 = (45 * BIPS100) / 100;    // 45% in basis points
    uint256 internal constant BIPS5 = (5 * BIPS100) / 100;      // 5% in basis points
    uint256 internal constant TERA = 10**12;                    // 10^12

    /**
     * @notice Initializes a new epoch instance for reveal with instance specific settings
     * @param _state                    Epoch state
     * @param _instance                 Epoch instance
     * @param _votePowerFlr             Epoch FLR vote power
     * @param _assets                   List of assets
     * @param _assetVotePowers          List of asset vote powers
     * @param _assetPrices              List of asset prices
     * @dev _votePowerFlr is assumed to be smaller than 2**128 to avoid overflows in computations
     * @dev computed votePowerAsset is assumed to be smaller than 2**128 to avoid overflows in computations
     */
    function _initializeInstanceForReveal(
        State storage _state,
        Instance storage _instance,
        // uint256 _circulatingSupplyFlr,
        uint256 _votePowerFlr,
        IFAsset[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) internal
    {    
        // TODO: check somewhere that we never divide with 0  
        _setAssets(_state, _instance, _assets, _assetVotePowers, _assetPrices);
        _instance.votePowerBlock = _state.votePowerBlock;
        _instance.highAssetTurnoutBIPSThreshold = _state.highAssetTurnoutBIPSThreshold;
        _instance.lowFlrTurnoutBIPSThreshold = _state.lowFlrTurnoutBIPSThreshold;
        _instance.circulatingSupplyFlr = _votePowerFlr; // TODO _circulatingSupplyFlr;
        _instance.votePowerFlr = _votePowerFlr;
        _instance.minVotePowerFlr = _votePowerFlr / _state.minVotePowerFlrThreshold;
        _instance.minVotePowerAsset = _instance.votePowerAsset / _state.minVotePowerAssetThreshold;
        _instance.maxVotePowerFlr = _votePowerFlr / _state.maxVotePowerFlrThreshold;
        _instance.maxVotePowerAsset = _instance.votePowerAsset / _state.maxVotePowerAssetThreshold;
        _instance.initializedForReveal = true;
    }

    /**
     * @notice Adds a vote to the linked list representing an epoch instance
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _voteId               Id of the vote to add
     * @param _votePowerFlr         Vote power for FLR
     * @param _votePowerAsset       Vote power for asset
     * @param _random               Random number associated with the vote
     */
    function _addVote(
        State storage _state,
        Instance storage _instance,
        uint256 _voteId,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,
        uint256 _random
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
        _instance.accumulatedVotePowerFlr = _instance.accumulatedVotePowerFlr.add(_votePowerFlr);
        _instance.accumulatedVotePowerAsset = _instance.accumulatedVotePowerAsset.add(_votePowerAsset);
        _instance.random += _random;
        _instance.votes[msg.sender] = _voteId;
    }

    /**
     * @notice Returns the id of the epoch opened for price submission at the given timestamp
     * @param _state                Epoch state
     * @param _timestamp            Timestamp as seconds since unix epoch
     * @return Epoch id
     */
    function _getEpochId(State storage _state, uint256 _timestamp) internal view returns (uint256) {
        if (_timestamp < _state.firstEpochStartTime) {
            return 0;
        } else {
            return (_timestamp - _state.firstEpochStartTime) / _state.submitPeriod;
        }
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
        IFAsset[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) internal
    {
        _instance.assets = _assets;
        uint256 count = _assets.length;

        // compute sum of vote powers in USD
        uint256 votePowerSumUSD = 0;
        uint256[] memory values = new uint256[](count); // array of values which eventually contains weighted prices
        for (uint256 i = 0; i < count; i++) {
            if (address(_assets[i]) == address(0)) {
                continue;
            }
            uint256 votePowerUSD = _assetVotePowers[i].mulDiv(_assetPrices[i], _state.assetNorm[_assets[i]]);
            values[i] = votePowerUSD;
            votePowerSumUSD = votePowerSumUSD.add(votePowerUSD);
        }

        // determine asset weighted prices
        if (votePowerSumUSD > 0) {
            // determine shares based on asset vote powers in USD
            for (uint256 i = 0; i < count; i++) {
                // overriding/reusing array slots
                values[i] = values[i].mulDiv(_assetPrices[i].mul(BIPS100), votePowerSumUSD);
            }
        }
        _instance.assetWeightedPrices = values;

        // compute vote power
        uint256 votePower = _getAssetVotePower(_state, _instance, _assetVotePowers);
        _instance.votePowerAsset = votePower;

        // compute base weight ratio between asset and FLR
        _instance.baseWeightRatio = _getAssetBaseWeightRatio(_state, votePower);
    }

    /**
     * @notice Returns combined asset vote power
     * @param _state                Epoch state
     * @param _instance             Epoch instance
     * @param _votePowers           Array of asset vote powers
     * @dev Asset vote power is specified in USD and weighted among assets
     */
    function _getAssetVotePower(
        FtsoEpoch.State storage _state,
        FtsoEpoch.Instance storage _instance,
        uint256[] memory _votePowers
    ) internal view returns (uint256) {
        uint256 votePower = 0;
        for (uint256 i = 0; i < _instance.assets.length; i++) {
            if (address(_instance.assets[i]) == address(0)) {
                continue;
            }
            votePower = votePower.add(
                _instance.assetWeightedPrices[i].mulDiv(
                    _votePowers[i],
                    _state.assetNorm[_instance.assets[i]]
                ) / BIPS100
            );
        }
        return votePower;
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
     * @param _instance             Epoch instance
     * @return Weight ratio for asset in BIPS (a number between 0 and BIPS)
     * @dev Weight ratio for FLR is supposed to be (BIPS - weight ratio for asset)
     */
    function _getWeightRatio(
        Instance storage _instance
    ) internal view returns (uint256)
    {
        if (_instance.weightAssetSum == 0) {
            return 0;
        } else if (_instance.weightFlrSum == 0) {
            return BIPS100;
        }
        
        uint256 turnout = _instance.weightAssetSum.mulDiv(BIPS100, TERA);
        if (turnout >= _instance.highAssetTurnoutBIPSThreshold) {
            return _instance.baseWeightRatio;
        } else {
            return _instance.baseWeightRatio.mulDiv(turnout, _instance.highAssetTurnoutBIPSThreshold);
        }
    }

    /**
     * @notice Computes vote weights in epoch
     * @param _instance             Epoch instance
     * @param _weightsFlr           Array of FLR weights
     * @param _weightsAsset         Array of asset weights
     * @return _weights              Array of combined weights
     * @dev All weight parameters and variables are in BIPS
     */
    function _computeWeights(
        FtsoEpoch.Instance storage _instance,
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset
    ) internal view returns (uint256[] memory _weights)
    {
        _weights = new uint256[](_instance.voteCount);

        uint256 weightFlrSum = _instance.weightFlrSum;
        uint256 weightAssetSum = _instance.weightAssetSum;
        
        // set weight distribution according to weight sums and weight ratio
        uint256 weightFlrShare = 0;
        uint256 weightAssetShare = _getWeightRatio(_instance);
        if (weightFlrSum > 0) {
            weightFlrShare = BIPS100 - weightAssetShare;
        }

        for (uint256 i = 0; i < _instance.voteCount; i++) {
            uint256 weightFlr = 0;
            if (weightFlrShare > 0) {
                weightFlr = weightFlrShare.mulDiv(TERA * _weightsFlr[i], weightFlrSum * BIPS100);
            }
            uint256 weightAsset = 0;
            if (weightAssetShare > 0) {
                weightAsset = weightAssetShare.mulDiv(TERA * _weightsAsset[i], weightAssetSum * BIPS100);
            }
            _weights[i] = weightFlr + weightAsset;
        }
    }

}
