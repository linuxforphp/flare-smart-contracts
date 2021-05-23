// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../lib/FtsoEpoch.sol";
import "../../token/interface/IIVPToken.sol";

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
        IIVPToken[] assets;                       // list of assets
        uint256[] assetWeightedPrices;          // prices that determine the contributions of assets to vote power
        address[] trustedAddresses;             // trusted addresses - set only when used
        uint256 finalizedTimestamp;             // block.timestamp of time when price is decided
        bool initializedForReveal;              // whether epoch instance is initialized for reveal
        bool rewardedFtso;                      // whether current epoch instance was a rewarded ftso
        bool panicMode;                         // current epoch in panic mode
    }

    FtsoEpoch.State private state;

    constructor(
        uint256 _firstEpochStartTime,            // start time of the first epoch instance
        uint256 _submitPeriod,                   // duration of price submission for an epoch instance
        uint256 _revealPeriod) {                 // duration of price reveal for an epoch instance
        state.firstEpochStartTime = _firstEpochStartTime;
        state.submitPeriod = _submitPeriod;
        state.revealPeriod = _revealPeriod;
    }

    function setAssetNorm(IIVPToken _fasset, uint256 _decimals) public {
        state.assetNorm[_fasset] = 10**_decimals;
    }

    function initializeInstanceForReveal(
        uint256 _epochId,
        uint256 _votePowerFlr,
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) public {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._initializeInstanceForReveal(
            epoch,
            _votePowerFlr, 
            _assets,
            _assetVotePowers,
            _assetPrices);
    }

    function addVote(
        uint256 _epochId,
        uint256 _voteId,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,        
        uint256 _random
    ) public {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._addVote(epoch, _voteId, _votePowerFlr, _votePowerAsset, _random);
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
        state.minVotePowerFlrThreshold = _minVotePowerFlrThreshold;
        state.minVotePowerAssetThreshold = _minVotePowerAssetThreshold;
        state.maxVotePowerFlrThreshold = _maxVotePowerFlrThreshold;
        state.maxVotePowerAssetThreshold = _maxVotePowerAssetThreshold;
        state.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        state.highAssetUSDThreshold = _highAssetUSDThreshold;
        state.highAssetTurnoutBIPSThreshold = _highAssetTurnoutBIPSThreshold;
        state.lowFlrTurnoutBIPSThreshold = _lowFlrTurnoutBIPSThreshold;
        state.trustedAddresses = _trustedAddresses;
    }

    function setVotePowerBlock(uint256 _votePowerBlock) public {
        state.votePowerBlock = _votePowerBlock;
    }

    function getEpochInstance(uint256 _epochId) public view returns(Instance memory) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        Instance memory result;

        result.votePowerBlock = epoch.votePowerBlock;
        result.highAssetTurnoutBIPSThreshold = epoch.highAssetTurnoutBIPSThreshold;
        result.lowFlrTurnoutBIPSThreshold = epoch.lowFlrTurnoutBIPSThreshold;
        result.votePowerFlr = epoch.votePowerFlr;
        result.votePowerAsset = epoch.votePowerAsset;
        result.minVotePowerFlr = epoch.minVotePowerFlr;
        result.minVotePowerAsset = epoch.minVotePowerAsset;
        result.maxVotePowerFlr = epoch.maxVotePowerFlr;
        result.maxVotePowerAsset = epoch.maxVotePowerAsset;
        result.accumulatedVotePowerFlr = epoch.accumulatedVotePowerFlr;
        result.accumulatedVotePowerAsset = epoch.accumulatedVotePowerAsset;
        result.weightFlrSum = epoch.weightFlrSum;
        result.weightAssetSum = epoch.weightAssetSum;
        result.baseWeightRatio = epoch.baseWeightRatio;
        result.firstVoteId = epoch.firstVoteId;
        result.truncatedFirstQuartileVoteId = epoch.truncatedFirstQuartileVoteId;
        result.truncatedLastQuartileVoteId = epoch.truncatedLastQuartileVoteId;
        result.lastVoteId = epoch.lastVoteId;
        result.price = epoch.price;
        result.finalizationType = epoch.finalizationType;
        result.lowRewardedPrice = epoch.lowRewardedPrice;
        result.highRewardedPrice = epoch.highRewardedPrice;
        result.random = epoch.random;
        result.voteCount = epoch.voteCount;
        result.initializedForReveal = epoch.initializedForReveal;
        result.assets = epoch.assets;
        result.assetWeightedPrices = epoch.assetWeightedPrices;
        result.trustedAddresses = epoch.trustedAddresses;
        result.finalizedTimestamp = epoch.finalizedTimestamp;
        result.initializedForReveal = epoch.initializedForReveal;
        result.rewardedFtso = epoch.rewardedFtso;
        result.panicMode = epoch.panicMode;

        return result;
    }

    function getVoterVoteId(uint256 _epochId) public view returns (uint256) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return epoch.votes[msg.sender];
    }

    function setAssets(
        uint256 _epochId, 
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) public {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._setAssets(epoch, _assets, _assetVotePowers, _assetPrices);
    }

    function getAssetBaseWeightRatio(uint256 _assetVotePowerUSD) public view returns (uint256) {
        return state._getAssetBaseWeightRatio(_assetVotePowerUSD);
    }

    function getWeightRatio(uint256 _epochId) public view returns (uint256) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return FtsoEpoch._getWeightRatio(epoch);
    }

    function setWeightsParameters(
        uint256 _epochId,
        uint256 _weightFlrSum,
        uint256 _weightAssetSum
    ) public {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        epoch.weightFlrSum = _weightFlrSum;
        epoch.weightAssetSum = _weightAssetSum;
    }

    function computeWeights(
        uint256 _epochId,
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset
    ) public view returns (uint256[] memory) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return FtsoEpoch._computeWeights(epoch, _weightsFlr, _weightsAsset);
    }

    function getEpochId(uint256 _timestamp) public view returns (uint256) {
        return state._getEpochId(_timestamp);
    }

    function epochSubmitStartTime(uint256 _epochId) public view returns (uint256) {
        return state._epochSubmitStartTime(_epochId);
    }

    function epochSubmitEndTime(uint256 _epochId) public view returns (uint256) {
        return state._epochSubmitEndTime(_epochId);
    }

    function epochRevealEndTime( uint256 _epochId) public view returns (uint256) {
        return state._epochRevealEndTime(_epochId);
    }

    function epochRevealInProcess(uint256 _epochId) public view returns (bool) {
        return state._epochRevealInProcess(_epochId);
    }
}