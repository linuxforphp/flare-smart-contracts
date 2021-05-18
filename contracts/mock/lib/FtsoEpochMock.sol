// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../lib/FtsoEpoch.sol";
import "../../interfaces/IFAsset.sol";

/**
 * @title Ftso Vote mock contract
 * @notice A contract to expose the FtsoVote library for unit testing.
 **/
contract FtsoEpochMock {
    using FtsoEpoch for FtsoEpoch.State;

    struct Instance {                           // struct holding epoch votes and results
        
        uint256 votePowerBlock;                 // block used to obtain vote weights in epoch
        uint256 highAssetTurnoutBIPSThreshold;  // threshold for high asset turnout (in BIPS)
        uint256 lowFlrTurnoutBIPSThreshold;     // threshold for low flr turnout (in BIPS)
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
        uint256 baseWeightRatio;                // base weight ratio between asset and FLR used to combine the weights
        uint256 firstVoteId;                    // id of the first vote in epoch
        uint256 truncatedFirstQuartileVoteId;   // first vote id eligible for reward
        uint256 firstQuartileVoteId;            // vote id corresponding to the first quartile
        uint256 medianVoteId;                   // vote id corresponding to the median
        uint256 lastQuartileVoteId;             // vote id corresponding to the last quartile
        uint256 truncatedLastQuartileVoteId;    // last vote id eligible for reward
        uint256 lastVoteId;                     // id of the last vote in epoch
        uint256 price;                          // consented epoch asset price
        uint256 lowRewardedPrice;               // the lowest submitted price eligible for reward
        uint256 highRewardedPrice;              // the highest submitted price elibible for reward
        uint256 random;                         // random number associated with the epoch
        uint256 voteCount;                       // number of votes in epoch
        bool initializedForReveal;              // whether epoch instance is initialized for reveal
        IFAsset[] assets;                       // list of assets
        uint256[] assetWeightedPrices;          // prices that determine the contributions of assets to vote power
    }

    FtsoEpoch.State private _state;

    constructor(
        uint256 firstEpochStartTime,            // start time of the first epoch instance
        uint256 submitPeriod,                   // duration of price submission for an epoch instance
        uint256 revealPeriod) {                 // duration of price reveal for an epoch instance
        _state.firstEpochStartTime = firstEpochStartTime;
        _state.submitPeriod = submitPeriod;
        _state.revealPeriod = revealPeriod;
    }

    function setAssetNorm(IFAsset fasset, uint8 decimals) public {
        _state.assetNorm[fasset] = 10**decimals;
    }

    function _initializeInstanceForReveal(
        uint256 epochId,
        uint256 _votePowerFlr,
        IFAsset[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices) public {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        _state._initializeInstanceForReveal(
            _epoch,
            _votePowerFlr, 
            _assets,
            _assetVotePowers,
            _assetPrices);
    }

    function _addVote(
        uint256 epochId,
        uint256 _voteId,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,        
        uint256 _random) public {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        _state._addVote(_epoch, _voteId, _votePowerFlr, _votePowerAsset, _random);
        }

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
    ) public {
        _state.minVotePowerFlrThreshold = _minVotePowerFlrThreshold;
        _state.minVotePowerAssetThreshold = _minVotePowerAssetThreshold;
        _state.maxVotePowerFlrThreshold = _maxVotePowerFlrThreshold;
        _state.maxVotePowerAssetThreshold = _maxVotePowerAssetThreshold;
        _state.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        _state.highAssetUSDThreshold = _highAssetUSDThreshold;
        _state.highAssetTurnoutBIPSThreshold = _highAssetTurnoutBIPSThreshold;
        _state.lowFlrTurnoutBIPSThreshold = _lowFlrTurnoutBIPSThreshold;
        _state.trustedAddresses = _trustedAddresses;
    }

    function setVotePowerBlock(uint256 votePowerBlock) public {
        _state.votePowerBlock = votePowerBlock;
    }

    function getEpochInstance(uint256 epochId) public view returns(Instance memory) {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        Instance memory epoch;

        epoch.votePowerBlock = _epoch.votePowerBlock;
        epoch.highAssetTurnoutBIPSThreshold = _epoch.highAssetTurnoutBIPSThreshold;
        epoch.lowFlrTurnoutBIPSThreshold = _epoch.lowFlrTurnoutBIPSThreshold;
        epoch.votePowerFlr = _epoch.votePowerFlr;
        epoch.votePowerAsset = _epoch.votePowerAsset;
        epoch.minVotePowerFlr = _epoch.minVotePowerFlr;
        epoch.minVotePowerAsset = _epoch.minVotePowerAsset;
        epoch.maxVotePowerFlr = _epoch.maxVotePowerFlr;
        epoch.maxVotePowerAsset = _epoch.maxVotePowerAsset;
        epoch.accumulatedVotePowerFlr = _epoch.accumulatedVotePowerFlr;
        epoch.accumulatedVotePowerAsset = _epoch.accumulatedVotePowerAsset;
        epoch.weightFlrSum = _epoch.weightFlrSum;
        epoch.weightAssetSum = _epoch.weightAssetSum;
        epoch.baseWeightRatio = _epoch.baseWeightRatio;
        epoch.firstVoteId = _epoch.firstVoteId;
        epoch.truncatedFirstQuartileVoteId = _epoch.truncatedFirstQuartileVoteId;
        epoch.truncatedLastQuartileVoteId = _epoch.truncatedLastQuartileVoteId;
        epoch.lastVoteId = _epoch.lastVoteId;
        epoch.price = _epoch.price;
        epoch.lowRewardedPrice = _epoch.lowRewardedPrice;
        epoch.highRewardedPrice = _epoch.highRewardedPrice;
        epoch.random = _epoch.random;
        epoch.voteCount = _epoch.voteCount;
        epoch.initializedForReveal = _epoch.initializedForReveal;
        epoch.assets = _epoch.assets;
        epoch.assetWeightedPrices = _epoch.assetWeightedPrices;

        return epoch;
    }

    function getVoterVoteId(uint256 epochId) public view returns (uint256) {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        return _epoch.votes[msg.sender];
    }

    function _setAssets(uint256 epochId, 
        IFAsset[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices) public {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        _state._setAssets(_epoch, _assets, _assetVotePowers, _assetPrices);
    }

    function _getAssetBaseWeightRatio(
        uint256 _assetVotePowerUSD) public view returns (uint256) {
        return _state._getAssetBaseWeightRatio(_assetVotePowerUSD);
    }

    function _getWeightRatio(
        uint256 epochId) public view returns (uint256) {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        return FtsoEpoch._getWeightRatio(_epoch);
    }

    function _setWeightsParameters(
        uint256 epochId,
        uint256 _weightFlrSum,
        uint256 _weightAssetSum
    ) public {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        _epoch.weightFlrSum = _weightFlrSum;
        _epoch.weightAssetSum = _weightAssetSum;
    }

    function computeWeights(
        uint256 epochId,
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset) public view returns (uint256[] memory _weights) {
        FtsoEpoch.Instance storage _epoch = _state.instance[epochId];
        _weights = FtsoEpoch._computeWeights(_epoch, _weightsFlr, _weightsAsset);
    }

    function _getEpochId(uint256 _timestamp) public view returns (uint256) {
        return _state._getEpochId(_timestamp);
    }

    function _epochSubmitStartTime(uint256 _epochId) public view returns (uint256) {
        return _state._epochSubmitStartTime(_epochId);
    }

    function _epochSubmitEndTime(uint256 _epochId) public view returns (uint256) {
        return _state._epochSubmitEndTime(_epochId);
    }

    function _epochRevealEndTime( uint256 _epochId) public view returns (uint256) {
        return _state._epochRevealEndTime(_epochId);
    }

    function _epochRevealInProcess(uint256 _epochId) public view returns (bool) {
        return _state._epochRevealInProcess(_epochId);
    }
}