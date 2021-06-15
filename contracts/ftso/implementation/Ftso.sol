// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../token/interface/IIVPToken.sol";
import "../interface/IIFtso.sol";
import "../interface/IIFtsoManager.sol";
import "../lib/FtsoEpoch.sol";
import "../lib/FtsoVote.sol";
import "../lib/FtsoMedian.sol";


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
    string internal constant ERR_PRICE_REVEAL_FAILURE = "Reveal period not active";
    string internal constant ERR_PRICE_INVALID = "Price already revealed or not valid";
    string internal constant ERR_EPOCH_FINALIZATION_FAILURE = "Epoch not ready for finalization";
    string internal constant ERR_EPOCH_ALREADY_FINALIZED = "Epoch already finalized";
    string internal constant ERR_VOTEPOWER_INSUFFICIENT = "Insufficient vote power to submit vote";
    string internal constant ERR_FASSET_INVALID = "Invalid asset";
    string internal constant ERR_EPOCH_NOT_INITIALIZED_FOR_REVEAL = "Epoch not initialized for reveal";
    string internal constant ERR_EPOCH_UNKNOWN = "Unknown epoch";

    // storage    
    bool public override active;                // activation status of FTSO
    string public override symbol;              // asset symbol that identifies FTSO
    uint256 internal fAssetPriceUSD;            // current FAsset USD price
    uint256 internal fAssetPriceTimestamp;      // time when price was updated
    FtsoEpoch.State internal epochs;            // epoch storage
    FtsoVote.State internal votes;              // vote storage
    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;

    // external contracts
    IIVPToken public immutable wFlr;             // wrapped FLR
    IIFtsoManager public immutable ftsoManager;  // FTSO manager contract
    IPriceSubmitter public priceSubmitter;       // Price submitter contract
    IIVPToken[] public fAssets;                  // array of assets
    IIFtso[] public fAssetFtsos;                 // FTSOs for assets (for a multi-asset FTSO)

    modifier whenActive {
        require(active, ERR_NOT_ACTIVE);
        _;
    }

    modifier onlyFtsoManager {
        require(msg.sender == address(ftsoManager), ERR_NO_ACCESS);
        _;
    }

    modifier onlyPriceSubmitter {
        require(msg.sender == address(priceSubmitter), ERR_NO_ACCESS);
        _;
    }

    constructor(
        string memory _symbol,
        IIVPToken _wFlr,
        IIFtsoManager _ftsoManager,
        uint256 _initialPriceUSD
    ) {
        symbol = _symbol;
        wFlr = _wFlr;
        ftsoManager = _ftsoManager;
        fAssetPriceUSD = _initialPriceUSD;
        fAssetPriceTimestamp = block.timestamp;
    }

    /**
     * @notice Submits price hash for current epoch
     * @param _hash                 Hashed price and random number
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHash(bytes32 _hash) external override whenActive {
        _submitPriceHash(msg.sender, _hash);
    }

    /**
     * @notice Submits price hash for current epoch
     * @param _sender               Sender address
     * @param _hash                 Hashed price and random number
     * @return _epochId             Returns current epoch id
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHashSubmitter(
        address _sender,
        bytes32 _hash
    ) external override whenActive onlyPriceSubmitter returns (uint256 _epochId) {
        return _submitPriceHash(_sender, _hash);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPrice(
        uint256 _epochId,
        uint256 _price,
        uint256 _random
    ) external override whenActive {
        _revealPrice(msg.sender, _epochId, _price, _random);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPriceSubmitter(
        address _voter,
        uint256 _epochId,
        uint256 _price,
        uint256 _random
    ) external override whenActive onlyPriceSubmitter {
        _revealPrice(_voter, _epochId, _price, _random);
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
        FtsoEpoch.Instance storage epoch = _getEpochForFinalization(_epochId);

        uint256 flrTurnout = 0;
        if (epoch.circulatingSupplyFlr > 0) {
            // no overflow - epoch.accumulatedVotePowerFlr is the sum of all WFLRs of voters for given vote power block
            flrTurnout = epoch.accumulatedVotePowerFlr * FtsoEpoch.BIPS100 / epoch.circulatingSupplyFlr;
        }
        if (epoch.fallbackMode || flrTurnout <= epoch.lowFlrTurnoutBIPSThreshold) {
            if (!epoch.fallbackMode) {
                emit LowTurnout(_epochId, flrTurnout, epoch.lowFlrTurnoutBIPSThreshold, block.timestamp);
            }
            _averageFinalizePriceEpoch(_epochId, epoch, false);

            // return empty reward data
            return (_eligibleAddresses, _flrWeights, _flrWeightsSum);
        } 

        // finalizationType = PriceFinalizationType.MEDIAN
        // extract data from epoch votes to memory
        uint256[] memory vote;
        uint256[] memory price;
        uint256[] memory weight;
        uint256[] memory weightFlr;
        (vote, price, weight, weightFlr) = _readVotes(epoch);

        // compute weighted median and truncated quartiles
        uint256[] memory index;
        FtsoMedian.Data memory data;
        (index, data) = FtsoMedian._compute(price, weight);

        // store epoch results
        _writeEpochPriceData(epoch, data, index, price, vote);

        // return reward data if requested
        if (_returnRewardData) {
            (_eligibleAddresses, _flrWeights, _flrWeightsSum) = _readRewardData(data, index, weightFlr, vote);
            if (_eligibleAddresses.length > 0) {
                epoch.rewardedFtso = true;
            }
        }

        // inform about epoch result
        emit PriceFinalized(_epochId, epoch.price, epoch.rewardedFtso, 
            epoch.lowRewardedPrice, epoch.highRewardedPrice, epoch.finalizationType,
            block.timestamp);
    }

    /**
     * @notice Forces finalization of price epoch calculating average price from trusted addresses
     * @param _epochId              Id of the epoch to finalize
     * @dev Used as a fallback method if epoch finalization is failing
     */
    function averageFinalizePriceEpoch(uint256 _epochId) external override onlyFtsoManager {
        FtsoEpoch.Instance storage epoch = _getEpochForFinalization(_epochId);
        _averageFinalizePriceEpoch(_epochId, epoch, true);
    }

    /**
     * @notice Forces finalization of price epoch - only called when exception happened
     * @param _epochId              Id of the epoch to finalize
     * @dev Used as a fallback method if epoch finalization is failing
     */
    function forceFinalizePriceEpoch(uint256 _epochId) external override onlyFtsoManager {
        FtsoEpoch.Instance storage epoch = _getEpochForFinalization(_epochId);
        epoch.trustedAddresses = epochs.trustedAddresses;
        _forceFinalizePriceEpoch(_epochId, epoch, true);
    }

    /**
     * @notice Initializes ftso immutable settings and activates oracle
     * @param _priceSubmitter       Price submitter contract
     * @param _firstEpochStartTime  Timestamp of the first epoch as seconds from unix epoch
     * @param _submitPeriod         Duration of epoch submission period in seconds
     * @param _revealPeriod         Duration of epoch reveal period in seconds
     */
    function activateFtso(
        IPriceSubmitter _priceSubmitter,
        uint256 _firstEpochStartTime,
        uint256 _submitPeriod,
        uint256 _revealPeriod
    ) external override onlyFtsoManager
    {
        require(!active, ERR_ALREADY_ACTIVATED);
        priceSubmitter = _priceSubmitter;
        epochs.firstEpochStartTime = _firstEpochStartTime;
        epochs.submitPeriod = _submitPeriod;
        epochs.revealPeriod = _revealPeriod;
        active = true;
    }

    /**
     * @notice Deactivates oracle
     */
    function deactivateFtso() external override whenActive onlyFtsoManager {
        active = false;
    }

    /**
     * Updates initial/current fasset price, but only if not active
     */
    function updateInitialPrice(
        uint256 _initialPriceUSD,
        uint256 _initialPriceTimestamp
    ) external override onlyFtsoManager {
        require(!active, ERR_ALREADY_ACTIVATED);
        fAssetPriceUSD = _initialPriceUSD;
        fAssetPriceTimestamp = _initialPriceTimestamp;
    }

    /**
     * @notice Sets configurable settings related to epochs
     * @param _minVotePowerFlrThreshold         low threshold for FLR vote power per voter
     * @param _minVotePowerAssetThreshold       low threshold for asset vote power per voter
     * @param _maxVotePowerFlrThreshold         high threshold for FLR vote power per voter
     * @param _maxVotePowerAssetThreshold       high threshold for FLR vote power per voter
     * @param _lowAssetUSDThreshold             threshold for low asset vote power
     * @param _highAssetUSDThreshold            threshold for high asset vote power
     * @param _highAssetTurnoutBIPSThreshold    threshold for high asset turnout
     * @param _lowFlrTurnoutBIPSThreshold       threshold for low flr turnout
     * @param _trustedAddresses                 trusted addresses - use their prices if low flr turnout is not achieved
     * @dev Should never revert if called from ftso manager
     */
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
    ) external override onlyFtsoManager
    {
        epochs.minVotePowerFlrThreshold = _minVotePowerFlrThreshold;
        epochs.minVotePowerAssetThreshold = _minVotePowerAssetThreshold;
        epochs.maxVotePowerFlrThreshold = _maxVotePowerFlrThreshold;
        epochs.maxVotePowerAssetThreshold = _maxVotePowerAssetThreshold;
        epochs.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        epochs.highAssetUSDThreshold = _highAssetUSDThreshold;
        epochs.highAssetTurnoutBIPSThreshold = _highAssetTurnoutBIPSThreshold;
        epochs.lowFlrTurnoutBIPSThreshold = _lowFlrTurnoutBIPSThreshold;

        // remove old addresses mapping
        uint256 len = epochs.trustedAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            epochs.trustedAddressesMapping[epochs.trustedAddresses[i]] = false;
        }
        // set new addresses mapping
        len = _trustedAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            epochs.trustedAddressesMapping[_trustedAddresses[i]] = true;
        }
        epochs.trustedAddresses = _trustedAddresses;
    }

    /**
     * @notice Sets current vote power block
     * @param _votePowerBlock       Vote power block
     */
    function setVotePowerBlock(uint256 _votePowerBlock) external override onlyFtsoManager {
        // votePowerBlock must be in the past to prevent flash loan attacks
        require(_votePowerBlock < block.number);
        epochs.votePowerBlock = _votePowerBlock;
    }

    /**
     * @notice Sets asset for FTSO to operate as single-asset oracle
     * @param _fAsset               Asset
     */
    function setFAsset(IIVPToken _fAsset) external override onlyFtsoManager {
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
        fAssets = new IIVPToken[](_fAssetFtsos.length);
        _refreshAssets();
    }

    /**
     * @notice Initializes current epoch instance for reveal
     * @param _fallbackMode            Current epoch in fallback mode
     */
    function initializeCurrentEpochStateForReveal(bool _fallbackMode) external override onlyFtsoManager {
        uint256 epochId = getCurrentEpochId();
        FtsoEpoch.Instance storage epoch = epochs.instance[epochId];
        if (_fallbackMode) {
            epoch.fallbackMode = true;
            return;
        }

        IIVPToken[] memory assets;
        uint256[] memory assetVotePowers;
        uint256[] memory assetPrices;
        (assets, assetVotePowers, assetPrices) = _getAssetData();

        epochs._initializeInstanceForReveal(
            epoch,
            _getVotePowerAt(wFlr, epochs.votePowerBlock),
            assets,
            assetVotePowers,
            assetPrices
        );

        emit PriceEpochInitializedOnFtso(epochId, epochs._epochSubmitEndTime(epochId), block.timestamp);
    }

    /**
     * @notice Returns current epoch data
     * @return _firstEpochStartTime         First epoch start time
     * @return _submitPeriod                Submit period in seconds
     * @return _revealPeriod                Reveal period in seconds
     */
    function getPriceEpochConfiguration() external view override returns (
        uint256 _firstEpochStartTime,
        uint256 _submitPeriod,
        uint256 _revealPeriod
    ) 
    {
        return (
            epochs.firstEpochStartTime, 
            epochs.submitPeriod,
            epochs.revealPeriod
        );
    }

    /**
     * @notice Returns current configuration of epoch state
     */
    function epochsConfiguration() external view override returns (
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutBIPSThreshold,
        uint256 _lowFlrTurnoutBIPSThreshold,
        address[] memory _trustedAddresses
    ) {
        return (
            epochs.minVotePowerFlrThreshold,
            epochs.minVotePowerAssetThreshold,
            epochs.maxVotePowerFlrThreshold,
            epochs.maxVotePowerAssetThreshold,
            epochs.lowAssetUSDThreshold,
            epochs.highAssetUSDThreshold,
            epochs.highAssetTurnoutBIPSThreshold,
            epochs.lowFlrTurnoutBIPSThreshold,
            epochs.trustedAddresses
        );
    }

    /**
     * @notice Returns the FTSO asset
     * @dev fAsset is null in case of multi-asset FTSO
     */
    function getFAsset() external view override returns (IIVPToken) {
        return fAssets.length == 1 && fAssetFtsos.length == 1 && fAssetFtsos[0] == this ?
            fAssets[0] : IIVPToken(address(0));
    }

    /**
     * @notice Returns the FAsset FTSOs
     * @dev FAssetFtsos is not null only in case of multi-asset FTSO
     */
    function getFAssetFtsos() external view override returns (IIFtso[] memory) {
        return fAssets.length == 1 && fAssetFtsos.length == 1 && fAssetFtsos[0] == this ?
            new IIFtso[](0) : fAssetFtsos;
    }

    /**
     * @notice Returns current FAsset price
     * @return _price               Price in USD multiplied by fAssetUSDDecimals
     * @return _timestamp           Time when price was updated for the last time
     */
    function getCurrentPrice() external view override returns (uint256 _price, uint256 _timestamp) {
        return (fAssetPriceUSD, fAssetPriceTimestamp);
    }

    /**
     * @notice Returns FAsset price consented in specific epoch
     * @param _epochId              Id of the epoch
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getEpochPrice(uint256 _epochId) external view override returns (uint256) {
        return epochs.instance[_epochId].price;
    }

    /**
     * @notice Returns FAsset price submitted by voter in specific epoch
     * @param _epochId              Id of the epoch
     * @param _voter                Address of the voter
     * @return Price in USD multiplied by fAssetUSDDecimals
     */
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external view override returns (uint256) {
        return votes.instance[epochs.instance[_epochId].votes[_voter]].price;
    }

    /**
     * @notice Returns current random number
     * @return Random number
     * @dev Should never revert
     */
    function getCurrentRandom() external view override returns (uint256) {
        uint256 currentEpochId = getCurrentEpochId();
        if (currentEpochId == 0) {
            return 0;
        }
        return epochs.instance[currentEpochId - 1].random;
    }

    /**
     * @notice Returns random number of the specified epoch
     * @param _epochId              Id of the epoch
     * @return Random number
     */
    function getRandom(uint256 _epochId) external view override returns (uint256) {
        return epochs.instance[_epochId].random;
    }

    /**
     * @notice Returns current epoch data
     * @return _epochId                 Current epoch id
     * @return _epochSubmitEndTime      End time of the current epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime      End time of the current epoch price reveal as seconds from unix epoch
     * @return _votePowerBlock          Vote power block for the current epoch
     * @return _minVotePowerFlr         Minimal vote power for WFLR (in WFLR) for the current epoch
     * @return _minVotePowerAsset       Minimal vote power for FAsset (in scaled USD) for the current epoch
     * @return _fallbackMode            Current epoch in fallback mode - only votes from trusted addresses will be used
     * @dev half-closed intervals - end time not included
     */
    function getPriceEpochData() external view override returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime,
        uint256 _votePowerBlock,
        uint256 _minVotePowerFlr,
        uint256 _minVotePowerAsset,
        bool _fallbackMode
    ) {
        _epochId = getCurrentEpochId();
        _epochSubmitEndTime = epochs._epochSubmitEndTime(_epochId);
        _epochRevealEndTime = _epochSubmitEndTime + epochs.revealPeriod;

        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        _votePowerBlock = epoch.votePowerBlock;
        _minVotePowerFlr = epoch.minVotePowerFlr;
        _minVotePowerAsset = epoch.minVotePowerAsset;
        _fallbackMode = epoch.fallbackMode;
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
    function getFullEpochReport(uint256 _epochId) external view override returns (
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
    ) {
        require(_epochId <= getCurrentEpochId(), ERR_EPOCH_UNKNOWN);
        _epochSubmitStartTime = epochs._epochSubmitStartTime(_epochId);
        _epochSubmitEndTime = epochs._epochSubmitEndTime(_epochId);        
        _epochRevealEndTime = epochs._epochRevealEndTime(_epochId);
        _epochFinalizedTimestamp = epochs.instance[_epochId].finalizedTimestamp;
        _price = epochs.instance[_epochId].price;
        _lowRewardPrice = epochs.instance[_epochId].lowRewardedPrice;
        _highRewardPrice = epochs.instance[_epochId].highRewardedPrice;
        _numberOfVotes = epochs.instance[_epochId].voteCount;
        _votePowerBlock = epochs.instance[_epochId].votePowerBlock;
        _finalizationType = epochs.instance[_epochId].finalizationType;
        _trustedAddresses = epochs.instance[_epochId].trustedAddresses;
        _rewardedFtso = epochs.instance[_epochId].rewardedFtso;
        _fallbackMode = epochs.instance[_epochId].fallbackMode;
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
    function getEpochVotes(uint256 _epochId) external view override returns (
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
     * @notice Returns current epoch id
     * @dev Should never revert
     */
    function getCurrentEpochId() public view override returns (uint256) {
        return getEpochId(block.timestamp);
    }

    /**
     * @notice Returns id of the epoch which was opened for price submission at the specified timestamp
     * @param _timestamp            Timestamp as seconds from unix epoch
     * @dev Should never revert
     */
    function getEpochId(uint256 _timestamp) public view override returns (uint256) {
        return epochs._getEpochId(_timestamp);
    }

    /**
     * @notice Submits price hash for current epoch
     * @param _hash Hashed price and random number
     * @notice Emits PriceHashSubmitted event
     */
    function _submitPriceHash(address _sender, bytes32 _hash) internal returns (uint256 _epochId){
        _epochId = getCurrentEpochId();
        epochVoterHash[_epochId][_sender] = _hash;
        emit PriceHashSubmitted(_sender, _epochId, _hash, block.timestamp);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function _revealPrice(address _voter, uint256 _epochId, uint256 _price, uint256 _random) internal {
        require(_price < 2**128, ERR_PRICE_TOO_HIGH);
        require(epochs._epochRevealInProcess(_epochId), ERR_PRICE_REVEAL_FAILURE);
        require(epochVoterHash[_epochId][_voter] == keccak256(abi.encode(_price, _random, _voter)), 
                ERR_PRICE_INVALID);
        // get epoch
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        require(epoch.initializedForReveal || (epoch.fallbackMode && epochs.trustedAddressesMapping[_voter]),
            ERR_EPOCH_NOT_INITIALIZED_FOR_REVEAL);

        // register vote
        (uint256 votePowerFlr, uint256 votePowerAsset) = _getVotePowerOf(epoch, _voter);
        uint256 voteId = votes._createInstance(
            _voter,
            votePowerFlr,
            votePowerAsset,
            epoch.votePowerFlr,
            epoch.votePowerAsset,
            _price
        );
        
        epochs._addVote(epoch,
            _voter,
            voteId,
            votePowerFlr,
            votePowerAsset,
            uint256(keccak256(abi.encode(_random, _price)))
        );

        // prevent price submission from being revealed twice
        delete epochVoterHash[_epochId][_voter];

        // inform about price reveal result
        emit PriceRevealed(_voter, _epochId, _price, _random, block.timestamp, votePowerFlr, votePowerAsset);
    }

    /**
     * @notice Returns the list of assets and its vote powers
     * @return _assets              List of assets
     * @return _votePowers          List of vote powers
     * @return _prices              List of asset prices
     */
    function _getAssetData() internal returns (
        IIVPToken[] memory _assets,
        uint256[] memory _votePowers,
        uint256[] memory _prices
    ) {
        _refreshAssets();
        _assets = fAssets;

        // compute vote power for each epoch
        _votePowers = new uint256[](_assets.length);
        _prices = new uint256[](_assets.length);
        for (uint256 i = 0; i < _assets.length; i++) {
            _votePowers[i] = _getVotePowerAt(_assets[i], epochs.votePowerBlock);
            (_prices[i], ) = fAssetFtsos[i].getCurrentPrice();
        }
    }
    
    /**
     * @notice Refreshes epoch state assets if FTSO is in multi-asset mode
     * @dev Assets are determined by other single-asset FTSOs on which the asset may change at any time
     */
    function _refreshAssets() internal {
        if (fAssetFtsos.length == 1 && fAssetFtsos[0] == this) {
            return;
        } else {
            for (uint256 i = 0; i < fAssetFtsos.length; i++) {
                IIVPToken asset = fAssetFtsos[i].getFAsset();
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
     * @notice Forces finalization of the epoch calculating average price from trusted addresses
     * @param _epochId              Epoch id
     * @param _epoch                Epoch instance
     * @param _exception            Indicates if the exception happened
     * @dev Sets the price to be the average of prices from trusted addresses or force finalize if no votes submitted
     */
    function _averageFinalizePriceEpoch(
        uint256 _epochId,
        FtsoEpoch.Instance storage _epoch,
        bool _exception
    ) internal {
        uint256 _priceSum;
        uint256 _count;
        
        _epoch.trustedAddresses = epochs.trustedAddresses;
        // extract data from epoch trusted votes to memory
        (_priceSum, _count) = _readTrustedVotes(_epoch);
        if (_count > 0) {
            // finalizationType = PriceFinalizationType.TRUSTED_ADDRESSES
            _epoch.price = _priceSum / _count;
            _epoch.finalizedTimestamp = block.timestamp;
            _epoch.finalizationType = _exception ?
                PriceFinalizationType.TRUSTED_ADDRESSES_EXCEPTION : PriceFinalizationType.TRUSTED_ADDRESSES;

            // update price
            fAssetPriceUSD = _epoch.price;
            fAssetPriceTimestamp = block.timestamp;

            // inform about epoch result
            emit PriceFinalized(_epochId, _epoch.price, false, 0, 0, _epoch.finalizationType, block.timestamp);
        } else {
            // finalizationType = PriceFinalizationType.PREVIOUS_PRICE_COPIED
            _forceFinalizePriceEpoch(_epochId, _epoch, _exception);
        }
    }

    /**
     * @notice Forces finalization of the epoch
     * @param _epochId              Epoch id
     * @param _epoch                Epoch instance
     * @param _exception            Indicates if the exception happened
     * @dev Sets the median price to be equal to the price from the previous epoch (if epoch id is 0, price is 0)
     */
    function _forceFinalizePriceEpoch(
        uint256 _epochId,
        FtsoEpoch.Instance storage _epoch,
        bool _exception
    ) internal {
        if (_epochId > 0) {
            _epoch.price = epochs.instance[_epochId - 1].price;
        } else {
            _epoch.price = 0;        
        }
        _epoch.finalizedTimestamp = block.timestamp;
        _epoch.finalizationType = _exception ? 
            PriceFinalizationType.PREVIOUS_PRICE_COPIED_EXCEPTION : PriceFinalizationType.PREVIOUS_PRICE_COPIED;

        emit PriceFinalized(_epochId, _epoch.price, false, 0, 0, _epoch.finalizationType, block.timestamp);
    }

    /**
     * @notice Extract vote data from epoch
     * @param _epoch                Epoch instance
     */
    function _readVotes(FtsoEpoch.Instance storage _epoch) internal returns (
        uint256[] memory _vote,
        uint256[] memory _price,
        uint256[] memory _weight,
        uint256[] memory _weightFlr
    ) {
        uint256 length = _epoch.voteCount;

        _vote = new uint256[](length);
        _price = new uint256[](length);        
        _weightFlr = new uint256[](length);

        uint256[] memory weightAsset = new uint256[](length);
        uint256 weightFlrSum = 0;
        uint256 weightAssetSum = 0;
        uint256 id = _epoch.firstVoteId;

        for(uint256 i = 0; i < length; i++) {
            FtsoVote.Instance storage v = votes.instance[id];
            _vote[i] = id;
            _price[i] = v.price;
            _weightFlr[i] = v.weightFlr;
            weightAsset[i] = v.weightAsset;
            weightFlrSum += _weightFlr[i];
            weightAssetSum += weightAsset[i];
            id = epochs.nextVoteId[id];
        }

        _epoch.weightFlrSum = weightFlrSum;
        _epoch.weightAssetSum = weightAssetSum;

        _weight = FtsoEpoch._computeWeights(_epoch, _weightFlr, weightAsset);
    }

    /**
     * @notice Stores epoch data related to price
     * @param _epoch                Epoch instance
     * @param _data                 Median computation data
     * @param _index                Array of vote indices
     * @param _price                Array of prices
     * @param _vote                 Array of vote ids
     */
    function _writeEpochPriceData(
        FtsoEpoch.Instance storage _epoch,
        FtsoMedian.Data memory _data, 
        uint256[] memory _index,
        uint256[] memory _price,
        uint256[] memory _vote
    ) internal
    {
        // relink results
        for (uint256 i = 0; i < _index.length - 1; i++) {
            epochs.nextVoteId[_vote[_index[i]]] = _vote[_index[i + 1]];
        }

        // store data
        _epoch.firstVoteId = _vote[_index[0]];
        _epoch.lastVoteId = _vote[_index[_index.length - 1]];
        _epoch.truncatedFirstQuartileVoteId = _vote[_index[_data.quartile1Index]];
        _epoch.truncatedLastQuartileVoteId = _vote[_index[_data.quartile3Index]];
        _epoch.lowRewardedPrice = _price[_index[_data.quartile1Index]];
        _epoch.price = _data.finalMedianPrice; 
        _epoch.highRewardedPrice = _price[_index[_data.quartile3Index]];
        _epoch.finalizedTimestamp = block.timestamp;
        _epoch.finalizationType = PriceFinalizationType.MEDIAN;

        // update price
        fAssetPriceUSD = _data.finalMedianPrice;
        fAssetPriceTimestamp = block.timestamp;
    }

    /**
     * @notice Returns FLR and asset vote power for epoch - returns (0, 0) if in fallback mode
     * @param _epoch                Epoch instance
     * @param _owner                Owner address
     * @dev Checks if vote power is sufficient and adjusts vote power if it is too large
     */
    function _getVotePowerOf(FtsoEpoch.Instance storage _epoch, address _owner) internal returns (
        uint256 _votePowerFlr,
        uint256 _votePowerAsset
    ) {
        if (_epoch.fallbackMode) {
            return (0, 0);
        }

        _votePowerFlr = _getVotePowerOfAt(wFlr, _owner, _epoch.votePowerBlock);
        
        uint256[] memory votePowersAsset = new uint256[](_epoch.assets.length);
        for (uint256 i = 0; i < _epoch.assets.length; i++) {
            votePowersAsset[i] = _getVotePowerOfAt(_epoch.assets[i], _owner, _epoch.votePowerBlock);
        }
        _votePowerAsset = epochs._getAssetVotePower(_epoch, votePowersAsset);
        
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
    function _getVotePowerAt(IIVPToken _vp, uint256 _vpBlock) internal returns (uint256) {
        if (address(_vp) == address(0)) {
            return 0;
        } else {
            return _vp.votePowerAtCached(_vpBlock);
        }
    }

    /**
     * @notice Returns vote power of the given token at the specified block and for the specified owner
     * @param _vp                   Vote power token
     * @param _vpBlock              Vote power block
     * @param _owner                Owner address
     * @dev Returns 0 if vote power token is null
     */
    function _getVotePowerOfAt(IIVPToken _vp, address _owner, uint256 _vpBlock) internal returns (uint256) {
        if (address(_vp) == address(0)) {
            return 0;
        } else {
            return _vp.votePowerOfAtCached(_owner, _vpBlock);
        }
    }
        
    /**
     * @notice Extract trusted vote data from epoch
     * @param _epoch                Epoch instance
     * @return _priceSum            Sum of all prices submitted by trusted addresses
     * @return _count               Number of prices submitted by trusted addresses
     */
    function _readTrustedVotes(FtsoEpoch.Instance storage _epoch) internal view returns (
        uint256 _priceSum,
        uint256 _count
    ) {
        uint256 length = _epoch.trustedAddresses.length;

        for(uint256 i = 0; i < length; i++) {
            address a = _epoch.trustedAddresses[i];
            uint256 id = _epoch.votes[a];
            if (id > 0) {
                FtsoVote.Instance storage v = votes.instance[id];
                _priceSum += v.price; // no overflow as v.price < 2**128
                _count++;
            }
        }
    }

    /**
     * @notice Extracts reward data for epoch
     * @param _data                 Median computation data
     * @param _index                Array of vote indices
     * @param _weightFlr            Array of FLR weights
     * @param _vote                 Array of vote ids
     */
    function _readRewardData(
        FtsoMedian.Data memory _data,
        uint256[] memory _index, 
        uint256[] memory _weightFlr,
        uint256[] memory _vote
    ) internal view returns (
        address[] memory _eligibleAddresses, 
        uint256[] memory _flrWeights,
        uint256 _flrWeightsSum
    ) {
        uint256 voteRewardCount = 0;
        for (uint256 i = _data.quartile1Index; i <= _data.quartile3Index; i++) {
            if (_weightFlr[_index[i]] > 0) {
                voteRewardCount++;
            }
        }

        _eligibleAddresses = new address[](voteRewardCount);
        _flrWeights = new uint256[](voteRewardCount);
        uint256 cnt = 0;
        for (uint256 i = _data.quartile1Index; i <= _data.quartile3Index; i++) {
            uint256 weight = _weightFlr[_index[i]];
            if (weight > 0) {
                uint256 id = _vote[_index[i]];
                _eligibleAddresses[cnt] = votes.sender[id];
                _flrWeights[cnt] = weight;
                _flrWeightsSum += weight;
                cnt++;
            }
        }        
    }

   /**
     * @notice Get epoch instance for given epoch id and check if it can be finished
     * @param _epochId              Epoch id
     * @return _epoch               Return epoch instance
     */
    function _getEpochForFinalization(uint256 _epochId) internal view returns (FtsoEpoch.Instance storage _epoch) {
        require(block.timestamp >= epochs._epochRevealEndTime(_epochId), ERR_EPOCH_FINALIZATION_FAILURE);
        _epoch = epochs.instance[_epochId];
        require(_epoch.finalizationType == PriceFinalizationType.NOT_FINALIZED, ERR_EPOCH_ALREADY_FINALIZED);
    }
}
