// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/internal/IIFtso.sol";
import "../interfaces/IFAsset.sol";
import "../interfaces/IFtsoManager.sol";
import "../lib/FtsoEpoch.sol";
import "../lib/FtsoVote.sol";
import "../lib/FtsoMedian.sol";

// import "hardhat/console.sol";

/**
 * @title A contract implementing Flare Time Series Oracle
 */
contract Ftso is IIFtso {

    using FtsoEpoch for FtsoEpoch.State;
    using FtsoVote for FtsoVote.State;

    // number of decimal places in FAsset USD price
    // note that the actual USD price is the integer value divided by 10^FASSET_USD_DECIMALS 
    uint256 public constant FASSET_USD_DECIMALS = 5;

    // errors
    string internal constant ERR_NOT_ACTIVE = "FTSO not active";
    string internal constant ERR_ALREADY_ACTIVATED = "FTSO already activated";
    string internal constant ERR_NO_ACCESS = "Access denied";
    string internal constant ERR_PRICE_TOO_HIGH = "Price too high";
    string internal constant ERR_PRICE_REVEAL_FAILURE = "Price reveal for epoch not possible";
    string internal constant ERR_PRICE_INVALID = "Price already revealed or not valid";
    string internal constant ERR_EPOCH_FINALIZATION_FAILURE = "Epoch not ready for finalization";
    string internal constant ERR_EPOCH_INSUFFICIENT_VOTES = "Epoch has insufficient number of votes";
    string internal constant ERR_VOTEPOWER_INSUFFICIENT = "Insufficient vote power to submit vote";
    string internal constant ERR_FASSET_INVALID = "Invalid asset";
    string internal constant ERR_EPOCH_NOT_INITIALIZED_FOR_REVEAL = "Epoch not initialized for reveal";
    string internal constant ERR_EPOCH_UNKNOWN = "Unknown epoch";

    // storage    
    bool public override active;                // activation status of FTSO
    string public override symbol;              // asset symbol that identifies FTSO
    uint256 internal fAssetPriceUSD;            // current FAsset USD price
    FtsoEpoch.State internal epochs;            // epoch storage
    FtsoVote.State internal votes;              // vote storage
    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;

    // external contracts
    IFAsset public immutable fFlr;              // wrapped FLR
    IFAsset[] public fAssets;                   // array of assets
    IIFtso[] public fAssetFtsos;                // FTSOs for assets (for a multi-asset FTSO)
    IFtsoManager public ftsoManager;            // FTSO manager contract

    constructor(
        string memory _symbol,
        IFAsset _fFlr,
        IFtsoManager _ftsoManager,
        uint256 _initialPriceUSD
    ) {
        symbol = _symbol;
        fFlr = _fFlr;
        ftsoManager = _ftsoManager;
        fAssetPriceUSD = _initialPriceUSD;
    }

    modifier whenActive {
        require(active, ERR_NOT_ACTIVE);
        _;
    }

    modifier onlyFtsoManager {
        require(msg.sender == address(ftsoManager), ERR_NO_ACCESS);
        _;
    }

    /**
     * @notice Submits price hash for current epoch
     * @param _hash                 Hashed price and random number
     * @notice Emits PriceSubmitted event
     */
    function submitPrice(bytes32 _hash) external override whenActive {
        uint256 epochId = getCurrentEpochId();
        epochVoterHash[epochId][msg.sender] = _hash;
        emit PriceSubmitted(msg.sender, epochId, _hash, block.timestamp);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) external override whenActive {
        require(_price < 2**128, ERR_PRICE_TOO_HIGH);
        require(epochs._epochRevealInProcess(_epochId), ERR_PRICE_REVEAL_FAILURE);
        require(epochVoterHash[_epochId][msg.sender] == keccak256(abi.encode(_price, _random)), ERR_PRICE_INVALID);

        // get epoch
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        require(epoch.initializedForReveal, ERR_EPOCH_NOT_INITIALIZED_FOR_REVEAL);

        // register vote
        (uint256 votePowerFlr, uint256 votePowerAsset) = getVotePowerOf(epoch, msg.sender);
        uint256 voteId = votes._createInstance(
            votePowerFlr,
            votePowerAsset,
            epoch.votePowerFlr,
            epoch.votePowerAsset,
            _price
        );
        epochs._addVote(epoch, voteId, votePowerFlr, votePowerAsset, _random, _price);
        
        // prevent price submission from being revealed twice
        delete epochVoterHash[_epochId][msg.sender];

        // inform about price reveal result
        emit PriceRevealed(msg.sender, _epochId, _price, _random, block.timestamp, votePowerFlr, votePowerAsset);
    }

    /**
     * @notice Computes epoch price based on gathered votes
     * @param _epochId              Id of the epoch
     * @param _returnRewardData     Parameter that determines if the reward data is returned
     * @return _eligibleAddresses   List of addresses eligible for reward
     * @return _flrWeights          List of FLR weights corresponding to the eligible addresses
     * @return _flrWeightsSum       Sum of weights in _flrWeights
     */
    function finalizePriceEpoch(
        uint256 _epochId,
        bool _returnRewardData
    ) external override onlyFtsoManager returns(
        address[] memory _eligibleAddresses,
        uint256[] memory _flrWeights,
        uint256 _flrWeightsSum
    ) {
        require(block.timestamp > epochs._epochRevealEndTime(_epochId), ERR_EPOCH_FINALIZATION_FAILURE);

        // get epoch
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        require(epoch.voteCount >= epochs.minVoteCount, ERR_EPOCH_INSUFFICIENT_VOTES);

        // extract data from epoch votes to memory
        uint256[] memory vote;
        uint256[] memory price;
        uint256[] memory weight;
        uint256[] memory weightFlr;
        (vote, price, weight, weightFlr) = readVotes(epoch);
        
        if(price.length == 0) {
            _forceFinalizePriceEpoch(_epochId);
            return (_eligibleAddresses, _flrWeights, 0);
        }

        // compute weighted median and truncated quartiles
        uint32[] memory index;
        FtsoMedian.Data memory data;
        (index, data) = FtsoMedian.compute(price, weight);

        // store epoch results
        writeEpochRewardData(epoch, data, index, weightFlr);
        writeEpochPriceData(epoch, data, index, price, vote);

        // return reward data if requested
        if (_returnRewardData) {
            (_eligibleAddresses, _flrWeights, _flrWeightsSum) = readRewardData(epoch, data, index, weightFlr, vote);
            if (_eligibleAddresses.length > 0) {
                epoch.rewardedFtso = true;
            }
        }

        // inform about epoch result
        emit PriceFinalized(_epochId, epoch.medianPrice, epoch.rewardedFtso, 
            epoch.lowRewardedPrice, epoch.highRewardedPrice, false);
    }

    /**
     * @notice Forces finalization of price epoch
     * @param _epochId              Id of the epoch to finalize
     * @dev Used as a fallback method if epoch finalization is failing
     */
    function forceFinalizePriceEpoch(uint256 _epochId) external override onlyFtsoManager {
        _forceFinalizePriceEpoch(_epochId);
    }

    /**
     * @notice Initializes epoch immutable settings and activates oracle
     * @param _firstEpochStartTime  Timestamp of the first epoch as seconds from unix epoch
     * @param _submitPeriod     Duration of epoch submission period in seconds
     * @param _revealPeriod         Duration of epoch reveal period in seconds
     * @dev This method can only be called once
     */
    function initializeEpochs(
        uint256 _firstEpochStartTime,
        uint256 _submitPeriod,
        uint256 _revealPeriod
    ) external override onlyFtsoManager
    {
        require(!active, ERR_ALREADY_ACTIVATED);
        epochs.firstEpochStartTime = _firstEpochStartTime;
        epochs.submitPeriod = _submitPeriod;
        epochs.revealPeriod = _revealPeriod;
        active = true;
    }

    function getPriceEpochConfiguration() external view override returns (
        uint256 firstEpochStartTime,
        uint256 submitPeriod,
        uint256 revealPeriod
    ) 
    {
        return (
            epochs.firstEpochStartTime, 
            epochs.submitPeriod,
            epochs.revealPeriod
        );
    }

    /**
     * @notice Sets configurable settings related to epochs
     * @param _minVoteCount                     minimal number of votes required in epoch
     * @param _minVotePowerFlrThreshold         low threshold for FLR vote power per voter
     * @param _minVotePowerAssetThreshold       low threshold for asset vote power per voter
     * @param _maxVotePowerFlrThreshold         high threshold for FLR vote power per voter
     * @param _maxVotePowerAssetThreshold       high threshold for FLR vote power per voter
     * @param _lowAssetUSDThreshold             threshold for low asset vote power
     * @param _highAssetUSDThreshold            threshold for high asset vote power
     * @param _highAssetTurnoutThreshold        threshold for high asset turnout
     */
    function configureEpochs(
        uint256 _minVoteCount,
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThreshold
    ) external override onlyFtsoManager
    {
        epochs.minVoteCount = _minVoteCount;
        epochs.minVotePowerFlrThreshold = _minVotePowerFlrThreshold;
        epochs.minVotePowerAssetThreshold = _minVotePowerAssetThreshold;
        epochs.maxVotePowerFlrThreshold = _maxVotePowerFlrThreshold;
        epochs.maxVotePowerAssetThreshold = _maxVotePowerAssetThreshold;
        epochs.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        epochs.highAssetUSDThreshold = _highAssetUSDThreshold;
        epochs.highAssetTurnoutThreshold = _highAssetTurnoutThreshold;
    }

    /**
     * @notice Sets current vote power block
     * @param _votePowerBlock       Vote power block
     */
    function setVotePowerBlock(uint256 _votePowerBlock) external override onlyFtsoManager {
        epochs.votePowerBlock = _votePowerBlock;
    }

    /**
     * @notice Sets asset for FTSO to operate as single-asset oracle
     * @param _fAsset               Asset
     */
    function setFAsset(IFAsset _fAsset) external override onlyFtsoManager {
        symbol = _fAsset.symbol();
        fAssetFtsos = [ IIFtso(this) ];
        fAssets = [ _fAsset ];
        epochs.assetNorm[_fAsset] = 10**_fAsset.decimals();
    }

    /**
     * @notice Sets an array of FTSOs for FTSO to operate as multi-asset oracle
     * @param _fAssetFtsos          Array of FTSOs
     * @dev FTSOs implicitly determine the FTSO assets
     */
    function setFAssetFtsos(IIFtso[] memory _fAssetFtsos) external override onlyFtsoManager {
        assert(_fAssetFtsos.length > 0);
        assert(_fAssetFtsos.length > 1 || _fAssetFtsos[0] != this);
        fAssetFtsos = _fAssetFtsos;
        fAssets = new IFAsset[](_fAssetFtsos.length);
        refreshAssets();
    }

    /**
     * @notice Initializes current epoch instance for reveal
     * @dev TODO: this function should not revert
     */
    function initializeCurrentEpochStateForReveal() external override onlyFtsoManager 
        returns (uint256 currentEpochId) {

        uint256 epochId = getCurrentEpochId();
        FtsoEpoch.Instance storage epoch = epochs.instance[epochId];

        IFAsset[] memory assets;
        uint256[] memory assetVotePowers;
        uint256[] memory assetPrices;
        (assets, assetVotePowers, assetPrices) = getAssetData();

        epochs._initializeInstance(
            epoch,
            getVotePower(fFlr, epochs.votePowerBlock),
            assets,
            assetVotePowers,
            assetPrices
        );

        epoch.initializedForReveal = true;
        emit PriceEpochInitializedOnFtso(epochId, epochs._epochSubmitEndTime(epochId));
        return epochId;
    }

    /**
     * @notice Returns current configuration of epoch state
     */
    function epochsConfiguration() external view override returns (
        uint256 minVoteCount,
        uint256 minVotePowerFlrThreshold,
        uint256 minVotePowerAssetThreshold,
        uint256 maxVotePowerFlrThreshold,
        uint256 maxVotePowerAssetThreshold,
        uint256 lowAssetUSDThreshold,
        uint256 highAssetUSDThreshold,
        uint256 highAssetTurnoutThreshold
    ) {
        return (
            epochs.minVoteCount,
            epochs.minVotePowerFlrThreshold,
            epochs.minVotePowerAssetThreshold,
            epochs.maxVotePowerFlrThreshold,
            epochs.maxVotePowerAssetThreshold,
            epochs.lowAssetUSDThreshold,
            epochs.highAssetUSDThreshold,
            epochs.highAssetTurnoutThreshold
        );
    }

    /**
     * @notice Returns the FTSO asset
     * @dev fAsset is null in case of multi-asset FTSO
     */
    function getFAsset() external view override returns (IFAsset) {
        return fAssets.length == 1 && fAssetFtsos.length == 1 && fAssetFtsos[0] == this ?
            fAssets[0] : IFAsset(address(0));
    }

    /**
     * @notice Returns current FAsset price
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getCurrentPrice() external view override returns (uint256) {
        return fAssetPriceUSD;
    }

    /**
     * @notice Returns FAsset price consented in specific epoch
     * @param _epochId              Id of the epoch
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getEpochPrice(uint256 _epochId) external view override returns (uint256) {
        return epochs.instance[_epochId].medianPrice;
    }

    /**
     * @notice Returns FAsset price submitted by voter in specific epoch
     * @param _epochId              Id of the epoch
     * @param _voter                Address of the voter
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external view override returns (uint256) {
        return epochs.instance[_epochId].voterPrice[_voter];
    }

    /**
     * @notice Returns current random number
     * @return Random number
     */
    function getCurrentRandom() external view override returns (uint256) {
        uint256 currentEpochId = getCurrentEpochId();
        if (currentEpochId == 0) {
            return 0;
        }
        return epochs.instance[currentEpochId -1].random;
    }

    /**
     * @notice Returns random number of the specified epoch
     * @param _epochId              Id of the epoch
     * @return Random number
     */
    function getRandom(uint256 _epochId) external override view returns (uint256) {
        return epochs.instance[_epochId].random;
    }

    /**
     * @notice Returns current epoch data
     * @return _epochId             Current epoch id
     * @return _epochSubmitEndTime  End time of the current epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime  End time of the current epoch price reveal as seconds from unix epoch
     */
    function getPriceEpochData() external view override returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime
    ) {
        _epochId = getCurrentEpochId();
        _epochSubmitEndTime = epochs._epochSubmitEndTime(_epochId);
        _epochRevealEndTime = _epochSubmitEndTime + epochs.revealPeriod;
    }

    /**
     * @notice Returns current epoch id
     */
    function getCurrentEpochId() public override view returns (uint256) {
        return getEpochId(block.timestamp);
    }

    /**
     * @notice Returns id of the epoch which was opened for price submission at the specified timestamp
     * @param _timestamp            Timestamp as seconds from unix epoch
     */
    function getEpochId(uint256 _timestamp) public override view returns (uint256) {
        return epochs._getEpochId(_timestamp);
    }

    /**
     * @notice Provides epoch summary
     * @param _epochId                  Id of the epoch
     * @return _epochSubmitStartTime    Start time of epoch price submission as seconds from unix epoch
     * @return _epochSubmitEndTime      End time of epoch price submission as seconds from unix epoch
     * @return _epochRevealStartTime    Start time of epoch price reveal as seconds from unix epoch
     * @return _epochRevealEndTime      End time of epoch price reveal as seconds from unix epoch
     * @return _price                   Finalized price for epoch
     * @return _lowRewardPrice          The lowest submitted price eligible for reward
     * @return _highRewardPrice         The highest submitted price eligible for reward
     * @return _numberOfVotes           Number of votes in epoch
     * @return _votePowerBlock          Block used for vote power inspection
     */
    function getFullEpochReport(uint256 _epochId) external override view returns (
        uint256 _epochSubmitStartTime,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealStartTime,
        uint256 _epochRevealEndTime,
        uint256 _price,
        uint256 _lowRewardPrice,
        uint256 _highRewardPrice,
        uint256 _numberOfVotes,
        uint256 _votePowerBlock,
        bool _rewardedFtso
    ) {
        require(_epochId <= getCurrentEpochId(), ERR_EPOCH_UNKNOWN);
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        _epochSubmitStartTime = epochs._epochSubmitStartTime(_epochId);
        _epochSubmitEndTime = epochs._epochSubmitEndTime(_epochId);
        _epochRevealStartTime = _epochSubmitEndTime;
        _epochRevealEndTime = epochs._epochRevealEndTime(_epochId);
        _price = epoch.medianPrice;
        _lowRewardPrice = epoch.lowRewardedPrice;
        _highRewardPrice = epoch.highRewardedPrice;
        _numberOfVotes = epoch.voteCount;
        _votePowerBlock = epoch.votePowerBlock;
        _rewardedFtso = epoch.rewardedFtso;
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
    function getEpochVotes(uint256 _epochId) external override view returns (
        address[] memory _voters,
        uint256[] memory _prices,
        uint256[] memory _weights,
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset,
        bool[] memory _eligibleForReward
    ) {
        require(_epochId <= getCurrentEpochId(), ERR_EPOCH_UNKNOWN);

        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];

        uint256 count = epoch.voteCount;
        _voters = new address[](count);
        _prices = new uint256[](count);
        _weights = new uint256[](count);
        _weightsFlr = new uint256[](count);
        _weightsAsset = new uint256[](count);
        _eligibleForReward = new bool[](count);

        uint256 id = epoch.firstVoteId;
        uint256 firstIdEligibleForReward = epoch.truncatedFirstQuartileVoteId;
        uint256 lastIdEligibleForReward = epoch.truncatedLastQuartileVoteId;
        bool eligibleForReward = false;
        for (uint256 i = 0; i < count; i++) {
            FtsoVote.Instance storage vote = votes.instance[id];
            _voters[i] = votes.sender[id];
            _prices[i] = vote.price;
            _weightsFlr[i] = vote.weightFlr;
            _weightsAsset[i] = vote.weightAsset;            
            if (id == firstIdEligibleForReward) {
                eligibleForReward = true;
            }
            _eligibleForReward[i] = eligibleForReward;
            if (id == lastIdEligibleForReward) {
                eligibleForReward = false;
            }
            id = epochs.nextVoteId[id];
        }
        _weights = FtsoEpoch._computeWeights(epoch, _weightsFlr, _weightsAsset);        
    }

    /**
     * @notice Returns the list of assets and its vote powers
     * @return _assets              List of assets
     * @return _votePowers          List of vote powers
     * @return _prices              List of asset prices
     */
    function getAssetData() internal returns (
        IFAsset[] memory _assets,
        uint256[] memory _votePowers,
        uint256[] memory _prices
    ) {
        refreshAssets();
        _assets = fAssets;

        // compute vote power for each epoch
        _votePowers = new uint256[](_assets.length);
        _prices = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            _votePowers[i] = getVotePower(_assets[i], epochs.votePowerBlock);
            _prices[i] = fAssetFtsos[i].getCurrentPrice();
        }
    }
    
    /**
     * @notice Refreshes epoch state assets if FTSO is in multi-asset mode
     * @dev Assets are determined by other single-asset FTSOs on which the asset may change at any time
     */
    function refreshAssets() internal {
        if (fAssetFtsos.length == 1 && fAssetFtsos[0] == this) {
            return;
        } else {
            for (uint256 i = 0; i < fAssetFtsos.length; i++) {
                IFAsset asset = fAssetFtsos[i].getFAsset();
                if (asset == fAssets[i]) {
                    continue;
                }
                fAssets[i] = asset;
                if (address(asset) != address(0)) {
                    epochs.assetNorm[asset] = 10**asset.decimals();
                }
            }
        }
    }

    /**
     * @notice Forces finalization of the epoch
     * @param _epochId              Epoch id
     * @dev Sets the median price to be equal to the price from the previous epoch (if epoch id is 0, price is 0)
     */
    function _forceFinalizePriceEpoch(uint256 _epochId) internal {
        if (_epochId > 0) {
            epochs.instance[_epochId].medianPrice = epochs.instance[_epochId - 1].medianPrice;
            emit PriceFinalized(_epochId, epochs.instance[_epochId - 1].medianPrice, false, 0, 0, true);
        } else {
            epochs.instance[_epochId].medianPrice = 0;
            emit PriceFinalized(_epochId, 0, false, 0, 0, true);
        }
    }

    /**
     * @notice Extract vote data from epoch
     * @param _epoch                Epoch instance
     */
    function readVotes(FtsoEpoch.Instance storage _epoch) internal returns (
        uint256[] memory vote,
        uint256[] memory price,
        uint256[] memory weight,
        uint256[] memory weightFlr
    ) {
        uint256 length = _epoch.voteCount;

        vote = new uint256[](length);
        price = new uint256[](length);        
        weightFlr = new uint256[](length);

        uint256[] memory weightAsset = new uint256[](length);
        uint256 weightFlrSum = 0;
        uint256 weightAssetSum = 0;
        uint256 id = _epoch.firstVoteId;

        for(uint32 i = 0; i < length; i++) {
            FtsoVote.Instance storage v = votes.instance[id];
            vote[i] = id;
            price[i] = v.price;
            weightFlr[i] = v.weightFlr;
            weightAsset[i] = v.weightAsset;
            weightFlrSum += weightFlr[i];
            weightAssetSum += weightAsset[i];
            id = epochs.nextVoteId[id];
        }

        epochs._setWeightsParameters(_epoch, weightFlrSum, weightAssetSum);
        weight = FtsoEpoch._computeWeights(_epoch, weightFlr, weightAsset);
    }

    /**
     * @notice Stores epoch data related to rewards
     * @param epoch                 Epoch instance
     * @param data                  Median computation data
     * @param index                 Array of vote indices
     * @param weightFlr             Array of FLR weights
     */
    function writeEpochRewardData(
        FtsoEpoch.Instance storage epoch,
        FtsoMedian.Data memory data,
        uint32[] memory index,
        uint256[] memory weightFlr
    ) internal
    {
        uint32 voteRewardCount = 0;
        uint256 flrRewardedWeightSum = 0;
        uint256 flrLowWeightSum = 0;
        uint256 flrHighWeightSum = 0;
        for (uint32 i = 0; i < epoch.voteCount; i++) {
            if(i < data.quartile1Index) {
                flrLowWeightSum += weightFlr[index[i]];
            } else if (i > data.quartile3Index) {
                flrHighWeightSum += weightFlr[index[i]];
            } else if (weightFlr[index[i]] > 0) {
                flrRewardedWeightSum += weightFlr[index[i]];
                voteRewardCount++;
            }
        }

        epoch.voteRewardCount = voteRewardCount;
        epoch.flrRewardedWeightSum = flrRewardedWeightSum;
        epoch.flrLowWeightSum = flrLowWeightSum;
        epoch.flrHighWeightSum = flrHighWeightSum;
    }

    /**
     * @notice Stores epoch data related to price
     * @param epoch                 Epoch instance
     * @param data                  Median computation data
     * @param index                 Array of vote indices
     * @param price                 Array of prices
     * @param vote                  Array of vote ids
     */
    function writeEpochPriceData(
        FtsoEpoch.Instance storage epoch,
        FtsoMedian.Data memory data, 
        uint32[] memory index,
        uint256[] memory price,
        uint256[] memory vote
    ) internal
    {
        // relink results
        for (uint32 i = 0; i < index.length - 1; i++) {
            epochs.nextVoteId[vote[index[i]]] = vote[index[i + 1]];
        }

        // store data
        epoch.firstVoteId = vote[index[0]];
        epoch.lastVoteId = vote[index[index.length - 1]];
        epoch.truncatedFirstQuartileVoteId = vote[index[data.quartile1Index]];
        epoch.truncatedLastQuartileVoteId = vote[index[data.quartile3Index]];
        epoch.firstQuartileVoteId = vote[index[data.quartile1IndexOriginal]];
        epoch.lastQuartileVoteId = vote[index[data.quartile3IndexOriginal]];
        epoch.medianVoteId = vote[index[data.medianIndex]];
        epoch.lowRewardedPrice = price[index[data.quartile1Index]];
        epoch.medianPrice = data.finalMedianPrice; 
        epoch.highRewardedPrice = price[index[data.quartile3Index]];
        epoch.lowWeightSum = data.lowWeightSum;
        epoch.highWeightSum = data.highWeightSum;
        epoch.rewardedWeightSum = data.rewardedWeightSum;

        // update price
        fAssetPriceUSD = data.finalMedianPrice;
    }

    /**
     * @notice Extracts reward data from epoch
     * @param epoch                 Epoch instance
     * @param data                  Median computation data
     * @param index                 Array of vote indices
     * @param weightFlr             Array of FLR weights
     * @param vote                  Array of vote ids
     */
    function readRewardData(
        FtsoEpoch.Instance storage epoch,
        FtsoMedian.Data memory data,
        uint32[] memory index, 
        uint256[] memory weightFlr,
        uint256[] memory vote
    ) internal view returns (
        address[] memory eligibleAddresses, 
        uint256[] memory flrWeights,
        uint256 flrWeightsSum
    ) {
        uint32 voteRewardCount = epoch.voteRewardCount;
        eligibleAddresses = new address[](voteRewardCount);
        flrWeights = new uint256[](voteRewardCount);
        uint32 cnt = 0;
        for (uint32 i = data.quartile1Index; i <= data.quartile3Index; i++) {
            if (weightFlr[index[i]] > 0) {
                uint256 id = vote[index[i]];
                eligibleAddresses[cnt] = votes.sender[id];
                flrWeights[cnt] = weightFlr[index[i]];
                cnt++;
            }
        }        
        flrWeightsSum = epoch.flrRewardedWeightSum;          
    }

    /**
     * @notice Returns FLR and asset vote power for epoch
     * @param _epoch                Epoch instance
     * @param _owner                Owner address
     * @dev Checks if vote power is sufficient and adjusts vote power if it is too large
     */
    function getVotePowerOf(FtsoEpoch.Instance storage _epoch, address _owner) internal view returns (
        uint256 _votePowerFlr,
        uint256 _votePowerAsset
    ) {
        _votePowerFlr = getVotePowerOf(fFlr, _epoch.votePowerBlock, _owner);
        
        uint256[] memory votePowersAsset = new uint256[](_epoch.assets.length);
        for (uint256 i = 0; i < _epoch.assets.length; i++) {            
            votePowersAsset[i] = getVotePowerOf(_epoch.assets[i], _epoch.votePowerBlock, _owner);
        }
        _votePowerAsset = epochs._getAssetVotePower(_epoch, votePowersAsset);
        
        // console.log("Vote power   flr: %s of %s", _votePowerFlr, _epoch.minVotePowerFlr);
        // console.log("           asset: %s of %s", _votePowerAsset, _epoch.minVotePowerAsset);
        
        require(
            (_votePowerFlr > 0 && _votePowerFlr >= _epoch.minVotePowerFlr) || 
                (_votePowerAsset > 0 && _votePowerAsset >= _epoch.minVotePowerAsset),
            ERR_VOTEPOWER_INSUFFICIENT
        );
        
        if (_votePowerFlr > _epoch.maxVotePowerFlr) {
            _votePowerFlr = _epoch.maxVotePowerFlr;
        }
        
        if (_votePowerAsset > _epoch.maxVotePowerAsset) {
            _votePowerAsset = _epoch.maxVotePowerAsset;
        }
    }

    /**
     * @notice Returns vote power of the given token at the specified block
     * @param _vp                   Vote power token
     * @param _vpBlock              Vote power block
     * @dev Returns 0 if vote power token is null
     */
    function getVotePower(IFAsset _vp, uint256 _vpBlock) internal view returns (uint256) {
        if (address(_vp) == address(0)) {
            return 0;
        } else {
            return _vp.votePowerAt(_vpBlock);
        }
    }

    /**
     * @notice Returns vote power of the given token at the specified block and for the specified owner
     * @param _vp                   Vote power token
     * @param _vpBlock              Vote power block
     * @param _owner                Owner address
     * @dev Returns 0 if vote power token is null
     */
    function getVotePowerOf(IFAsset _vp, uint256 _vpBlock, address _owner) internal view returns (uint256) {
        if (address(_vp) == address(0)) {
            return 0;
        } else {
            return _vp.votePowerOfAt(_owner, _vpBlock);
        }
    }

}
