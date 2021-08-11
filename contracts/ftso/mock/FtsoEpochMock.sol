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
        uint256 highAssetTurnoutThresholdBIPS;  // threshold for high asset turnout (in BIPS)
        uint256 lowFlrTurnoutThresholdBIPS;     // threshold for low flr turnout (in BIPS)
        uint256 circulatingSupplyFlr;           // total FLR circulating supply at votePowerBlock
        uint256 votePowerFlr;                   // total FLR vote power at votePowerBlock
        uint256 votePowerAsset;                 // total asset vote power at votePowerBlock
        uint256 maxVotePowerFlr;                // max FLR vote power required for voting
        uint256 maxVotePowerAsset;              // max asset vote power required for voting
        uint256 accumulatedVotePowerFlr;        // total FLR vote power accumulated from votes in epoch
        uint256 baseWeightRatio;                // base weight ratio between asset and FLR used to combine weights
        uint256 price;                          // consented epoch asset price
        IFtso.PriceFinalizationType finalizationType; // finalization type
        uint256 random;                         // random number associated with the epoch
        uint256 voteCount;                       // number of votes in epoch
        IIVPToken[] assets;                       // list of assets
        uint256[] assetWeightedPrices;          // prices that determine the contributions of assets to vote power
        bool initializedForReveal;              // whether epoch instance is initialized for reveal
        bool fallbackMode;                      // current epoch in fallback mode
    }

    FtsoEpoch.State private state;

    constructor(
        uint256 _firstEpochStartTime,  // start time of the first epoch instance
        uint256 _submitPeriod,         // duration of price submission for an epoch instance
        uint256 _revealPeriod)         // duration of price reveal for an epoch instance
    {
        state.firstEpochStartTime = _firstEpochStartTime;
        state.submitPeriod = _submitPeriod;
        state.revealPeriod = _revealPeriod;
    }

    function setAssetNorm(IIVPToken _fasset, uint256 _decimals) public {
        state.assetNorm[_fasset] = 10**_decimals;
    }

    function initializeInstanceForReveal(
        uint256 _epochId,
        uint256 _circulatingSupplyFlr,
        uint256 _votePowerFlr,
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) 
        public
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._initializeInstanceForReveal(
            epoch,
            _circulatingSupplyFlr,
            _votePowerFlr, 
            _assets,
            _assetVotePowers,
            _assetPrices);
    }

    function addVote(
        uint256 _epochId,
        address _voter,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,
        uint256 _price,
        uint256 _random
    )
        public
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        FtsoEpoch._addVote(epoch, _voter, _votePowerFlr, _votePowerAsset, _price, _random);
    }

    function configureEpochs(
        uint256 _maxVotePowerFlrThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowFlrTurnoutThresholdBIPS,
        address[] memory _trustedAddresses
    ) 
        public
    {
        state.maxVotePowerFlrThresholdFraction = _maxVotePowerFlrThresholdFraction;
        state.maxVotePowerAssetThresholdFraction = _maxVotePowerAssetThresholdFraction;
        state.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        state.highAssetUSDThreshold = _highAssetUSDThreshold;
        state.highAssetTurnoutThresholdBIPS = _highAssetTurnoutThresholdBIPS;
        state.lowFlrTurnoutThresholdBIPS = _lowFlrTurnoutThresholdBIPS;
        state.trustedAddresses = _trustedAddresses;
    }

    function setVotePowerBlock(uint256 _votePowerBlock) public {
        require (_votePowerBlock < 2 ** 240);
        state.votePowerBlock = uint240(_votePowerBlock);
    }
    
    function setAssets(
        uint256 _epochId, 
        IIVPToken[] memory _assets,
        uint256[] memory _assetVotePowers,
        uint256[] memory _assetPrices
    ) 
        public
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        state._setAssets(epoch, _assets, _assetVotePowers, _assetPrices);
    }
    
    function getEpochInstance(uint256 _epochId) public view returns(Instance memory) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        Instance memory result;

        result.votePowerBlock = epoch.votePowerBlock;
        result.highAssetTurnoutThresholdBIPS = epoch.highAssetTurnoutThresholdBIPS;
        result.lowFlrTurnoutThresholdBIPS = epoch.lowFlrTurnoutThresholdBIPS;
        result.circulatingSupplyFlr = epoch.circulatingSupplyFlr;
        result.votePowerFlr = epoch.votePowerFlr;
        result.votePowerAsset = epoch.votePowerAsset;
        result.maxVotePowerFlr = epoch.maxVotePowerFlr;
        result.maxVotePowerAsset = epoch.maxVotePowerAsset;
        result.accumulatedVotePowerFlr = epoch.accumulatedVotePowerFlr;
        result.baseWeightRatio = epoch.baseWeightRatio;
        result.price = epoch.price;
        result.finalizationType = epoch.finalizationType;
        result.random = epoch.random;
        result.voteCount = epoch.nextVoteIndex;
        result.initializedForReveal = epoch.initializedForReveal;
        result.assets = epoch.assets;
        result.assetWeightedPrices = epoch.assetWeightedPrices;
        result.initializedForReveal = epoch.initializedForReveal;
        result.fallbackMode = epoch.fallbackMode;

        return result;
    }

    function getVoterVoteId(uint256 _epochId) public view returns (uint256) {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return FtsoEpoch._findVoteOf(epoch, msg.sender);
    }

    function getAssetBaseWeightRatio(uint256 _assetVotePowerUSD) public view returns (uint256) {
        return state._getAssetBaseWeightRatio(_assetVotePowerUSD);
    }

    function getWeightRatio(
        uint256 _epochId, 
        uint256 _weightFlrSum, 
        uint256 _weightAssetSum
    ) 
        public view 
        returns (uint256)
    {
        FtsoEpoch.Instance storage epoch = state.instance[_epochId];
        return FtsoEpoch._getWeightRatio(epoch, _weightFlrSum, _weightAssetSum);
    }

    function computeWeights(
        uint256 _epochId,
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset
    ) 
        public view 
        returns (uint256[] memory)
    {
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
