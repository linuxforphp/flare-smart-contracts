// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IFtso.sol";
import "../IVotePower.sol";
import "../interfaces/IRewardManager.sol";
import "../lib/FtsoEpoch.sol";
import "../lib/FtsoVote.sol";
import "../lib/FtsoMedian.sol";

/**
 * @title A contract implementing Flare Time Series Oracle
 */
contract Ftso is IFtso {

    using FtsoEpoch for FtsoEpoch.State;
    using FtsoVote for FtsoVote.State;

    // number of decimal places in FAsset USD price
    // note that the real USD price is the integer value divided by 10^FASSET_USD_DECIMALS 
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
    string internal constant ERR_FASSET_SINGLE = "Single asset FTSO";
    string internal constant ERR_FASSET_INVALID = "Invalid asset";

    // storage    
    bool internal active;                       // activation status of FTSO
    uint256 public fAssetPriceUSD;              // current FAsset USD price
    FtsoEpoch.State internal epochs;            // epoch storage
    FtsoVote.State internal votes;              // vote storage
    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;

    // external contracts
    IVotePower public immutable fFlr;           // wrapped FLR
    IVotePower public fAsset;                   // wrapped asset (for a single-asset FTSO)
    IFtso[] public fAssetFtsos;                 // FTSOs for assets (for a multi-asset FTSO)
    IRewardManager public rewardManager;        // reward manager contract

    constructor(
        IVotePower _fFlr,
        IVotePower _fAsset,
        IRewardManager _rewardManager
    ) {
        fFlr = _fFlr;
        if (address(_fAsset) != address(0)) {
            // single-asset FTSO
            fAsset = _fAsset;
            fAssetFtsos = [ IFtso(this) ];
        }
        rewardManager = _rewardManager;
    }

    modifier whenActive {
        require(active, ERR_NOT_ACTIVE);
        _;
    }

    modifier onlyRewardManager {
        require(msg.sender == address(rewardManager), ERR_NO_ACCESS);
        _;
    }

    /**
     * @notice Submits price hash for current epoch
     * @param _hash                 Hashed price and random number
     * @notice Emits PriceSubmission event
     */
    function submitPrice(bytes32 _hash) external whenActive {
        uint256 epochId = getCurrentEpochId();
        epochVoterHash[epochId][msg.sender] = _hash;
        emit PriceSubmitted(msg.sender, epochId);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceReveal event
     */
    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) external whenActive {
        require(_price < 2**128, ERR_PRICE_TOO_HIGH);
        require(epochs._epochRevealInProcess(_epochId), ERR_PRICE_REVEAL_FAILURE);
        require(epochVoterHash[_epochId][msg.sender] == keccak256(abi.encodePacked(_price, _random)),
            ERR_PRICE_INVALID);
        
        // get epoch
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        if (epoch.voteCount == 0) {
            IVotePower[] memory assets;
            uint256[] memory assetVotePowers;
            uint256[] memory assetVotePowersUSD;
            (assets, assetVotePowers, assetVotePowersUSD) = getAssetData();
            epochs._initializeInstance(
                epoch,
                getVotePower(fFlr, epochs.votePowerBlock),
                assets,
                assetVotePowers,
                assetVotePowersUSD
            );
        }

        // register vote
        (uint256 votePowerFlr, uint256 votePowerAsset) = getVotePower(epoch);
        uint256 voteId = votes._createInstance(
            votePowerFlr,
            votePowerAsset,
            epoch.maxVotePowerFlr,
            epoch.maxVotePowerAsset,
            epoch.votePowerFlr,
            epoch.votePowerAsset,
            _price
        );
        epochs._addVote(epoch, voteId, votePowerFlr, votePowerAsset, _random, _price);
        
        // make sure price submission is be revealed twice
        delete epochVoterHash[_epochId][msg.sender];

        // inform about price reveal result
        emit PriceRevealed(msg.sender, _epochId, _price);
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
    ) public override onlyRewardManager returns(
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
        }

        // inform about epoch result
        emit PriceFinalized(_epochId, epoch.medianPrice);
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
    ) external override onlyRewardManager
    {
        require(!active, ERR_ALREADY_ACTIVATED);
        epochs.firstEpochStartTime = _firstEpochStartTime;
        epochs.submitPeriod = _submitPeriod;
        epochs.revealPeriod = _revealPeriod;
        active = true;
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
    ) external override onlyRewardManager
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
    function setVotePowerBlock(uint256 _votePowerBlock) external override onlyRewardManager {
        epochs.votePowerBlock = _votePowerBlock;
    }

    /**
     * @notice Sets FTSOs for multi-asset FTSO
     * @param _fAssetFtsos          List of FTSOs
     * @dev FTSOs implicitly determine the FTSO assets
     */
    function setFAssetFtsos(IFtso[] memory _fAssetFtsos) external override onlyRewardManager {
        require(!isSingleAssetFtso(), ERR_FASSET_SINGLE);
        fAssetFtsos = _fAssetFtsos;
    }

    /**
     * @notice Returns the FTSO asset
     * @dev fAsset is null in case of multi-asset FTSO
     */
    function getFAsset() external view override returns (IVotePower) {
        return fAsset;
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
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external override view returns (uint256) {
        return epochs.instance[_epochId].voterPrice[_voter];
    }

    /**
     * @notice Returns random number of the current epoch
     * @return Random number
     */
    function getCurrentRandom() external view override returns (uint256) {
        return epochs.instance[getCurrentEpochId()].random;
    }

    /**
     * @notice Returns current epoch data
     * @return _epochId             Current epoch id
     * @return _epochSubmitEndTime  End time of the current epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime  End time of the current epoch price reveal as seconds from unix epoch
     */
    function getEpochData() external view override returns (
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
    function getCurrentEpochId() public view returns (uint256) {
        return getEpochId(block.timestamp);
    }

    /**
     * @notice Returns id of the epoch which was opened for price submission at the specified timestamp
     * @param _timestamp            Timestamp as seconds from unix epoch
     */
    function getEpochId(uint256 _timestamp) public view returns (uint256) {
        return epochs._getEpochId(_timestamp);
    }

    /**
     * @notice Returns time left (in seconds) for price reveal in the given epoch, otherwise zero
     * @param _epochId              Id of the epoch
     */
    function getEpochRevealTimeLeft(uint256 _epochId) external view returns (uint256) {
        uint256 submitEndTime = epochs._epochRevealEndTime(_epochId);
        uint256 revealEndTime = submitEndTime + epochs.revealPeriod;
        if (submitEndTime < block.timestamp && block.timestamp < revealEndTime) {
            return revealEndTime - block.timestamp;
        } else {
            return 0;
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

        weight = computeWeights(_epoch, weightFlr, weightAsset, weightFlrSum, weightAssetSum);

        _epoch.weightFlrSum = weightFlrSum;
        _epoch.weightAssetSum = weightAssetSum;
    }

    /**
     * @notice Computes vote weights in epoch
     * @param epoch                 Epoch instance
     * @param weightFlr             Array of FLR weights
     * @param weightAsset           Array of asset weights
     * @param weightFlrSum          Sum of all FLR weights
     * @param weightAssetSum        Sum of all asset weights
     */
    function computeWeights(
        FtsoEpoch.Instance storage epoch,
        uint256[] memory weightFlr,
        uint256[] memory weightAsset,
        uint256 weightFlrSum,
        uint256 weightAssetSum
    ) internal view returns (uint256[] memory weight)
    {
        uint256 weightRatio = epochs._getWeightRatio(epoch);
        uint256 flrShare = (FtsoEpoch.BIPS100 - weightRatio) * weightAssetSum;
        uint256 assetShare = weightRatio * weightFlrSum;

        weight = new uint256[](epoch.voteCount);
        for (uint32 i = 0; i < epoch.voteCount; i++) {            
            weight[i] = flrShare * weightFlr[i] + assetShare * weightAsset[i];
        }
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
    )
        internal
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
        for (uint32 i = 0; i < data.length - 1; i++) {
            epochs.nextVoteId[vote[index[i]]] = vote[index[i + 1]];
        }

        // store data
        epoch.firstVoteId = vote[index[0]];
        epoch.lastVoteId = vote[index[data.length - 1]];
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
     * @notice Returns the list of assets and its vote powers
     * @return _assets              List of assets
     * @return _votePowers          List of vote powers
     * @return _votePowersUSD       List of vote powers in USD
     */
    function getAssetData() internal view returns (
        IVotePower[] memory _assets,
        uint256[] memory _votePowers,
        uint256[] memory _votePowersUSD
    ) {
        // gather assets
        if (isSingleAssetFtso()) {
            _assets = new IVotePower[](1);
            _assets[0] = fAsset;
        } else {
            // read assets from FTSOs
            _assets = new IVotePower[](fAssetFtsos.length);
            for (uint256 i = 0; i < fAssetFtsos.length; i++) {
                _assets[i] = fAssetFtsos[i].getFAsset();
                require(address(_assets[i]) != address(0), ERR_FASSET_INVALID);
            }
        }

        // compute vote power for each epoch
        _votePowers = new uint256[](_assets.length);
        _votePowersUSD = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 priceUSD = fAssetFtsos[i].getCurrentPrice();
            _votePowers[i] = getVotePower(_assets[i], epochs.votePowerBlock);            
            _votePowersUSD[i] = _votePowers[i] * priceUSD;
        }
    }

    /**
     * @notice Returns FLR and asset vote power for epoch
     * @param _epoch                Epoch instance
     * @dev Checks if vote power is sufficient and adjusts vote power if it is too large
     */
    function getVotePower(FtsoEpoch.Instance storage _epoch) internal view returns (
        uint256 votePowerFlr,
        uint256 votePowerAsset
    ) {
        votePowerFlr = getVotePowerOf(fFlr, _epoch.votePowerBlock, msg.sender);
        
        votePowerAsset = 0;
        for (uint256 i = 0; i < _epoch.assets.length; i++) {            
            votePowerAsset += (
                getVotePowerOf(_epoch.assets[i], _epoch.votePowerBlock, msg.sender) * _epoch.assetShares[i]
            );
        }
        votePowerAsset /= 1000;
        
        require(
            votePowerFlr >= _epoch.minVotePowerFlr || votePowerAsset >= _epoch.minVotePowerAsset,
            ERR_VOTEPOWER_INSUFFICIENT
        );
        
        if (votePowerFlr > _epoch.maxVotePowerFlr) {
            votePowerFlr = _epoch.maxVotePowerFlr;
        }
        
        if (votePowerAsset > _epoch.maxVotePowerAsset) {
            votePowerAsset = _epoch.maxVotePowerAsset;
        }
    }

    /**
     * @notice Returns vote power of the given token at the specified block
     * @param _vp                   Vote power token
     * @param _vpBlock              Vote power block
     * @dev Returns 0 if vote power token is null
     */
    function getVotePower(IVotePower _vp, uint256 _vpBlock) internal view returns (uint256) {
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
    function getVotePowerOf(IVotePower _vp, uint256 _vpBlock, address _owner) internal view returns (uint256) {
        if (address(_vp) == address(0)) {
            return 0;
        } else {
            return _vp.votePowerOfAt(_owner, _vpBlock);
        }
    }

    /**
     * @notice Determines if the FTSO has a single asset
     */
    function isSingleAssetFtso() internal view returns (bool) {
        return address(fAsset) != address(0);
    }

}
