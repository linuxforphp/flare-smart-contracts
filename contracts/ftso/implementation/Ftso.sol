// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../token/interface/IIVPToken.sol";
import "../../inflation/interface/IISupply.sol";
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
    uint256 public immutable priceDeviationThresholdBIPS; // threshold for price deviation between consecutive epochs
    bool public override active;                // activation status of FTSO
    string public override symbol;              // asset symbol that identifies FTSO
    uint256 internal fAssetPriceUSD;            // current FAsset USD price
    uint256 internal fAssetPriceTimestamp;      // time when price was updated    
    FtsoEpoch.State internal epochs;            // epoch storage
    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;
    uint256 internal lastRevealEpochId;

    // external contracts
    IIVPToken public immutable override wFlr;    // wrapped FLR
    IIFtsoManager public immutable ftsoManager;  // FTSO manager contract
    IISupply public immutable supply;            // Supply contract
    IPriceSubmitter public priceSubmitter;       // Price submitter contract
    IIVPToken[] public fAssets;                  // array of assets
    IIFtso[] public fAssetFtsos;                 // FTSOs for assets (for a multi-asset FTSO)

    // Revert strings get inlined and take a lot of contract space
    // Calling them from auxiliary functions removes used space
    modifier whenActive {
        if(!active){
            revertNotActive();
        }
        _;
    }

    modifier onlyFtsoManager {
        if(msg.sender != address(ftsoManager)){
            revertNoAccess();
        }
        _;
    }

    modifier onlyPriceSubmitter {
        if(msg.sender != address(priceSubmitter)){
            revertNoAccess();
        }
        _;
    }

    constructor(
        string memory _symbol,
        IIVPToken _wFlr,
        IIFtsoManager _ftsoManager,
        IISupply _supply,
        uint256 _initialPriceUSD,
        uint256 _priceDeviationThresholdBIPS
    )
    {
        symbol = _symbol;
        wFlr = _wFlr;
        ftsoManager = _ftsoManager;
        supply = _supply;
        fAssetPriceUSD = _initialPriceUSD;
        fAssetPriceTimestamp = block.timestamp;
        priceDeviationThresholdBIPS = _priceDeviationThresholdBIPS;
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
    ) 
        external override 
        whenActive 
        onlyPriceSubmitter 
        returns (uint256 _epochId)
    {
        return _submitPriceHash(_sender, _hash);
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
        uint256 _random,
        uint256 _wflrVP
    ) 
        external override
        whenActive
        onlyPriceSubmitter
    {
        _revealPrice(_voter, _epochId, _price, _random, _wflrVP);
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
    ) 
        external override
        onlyFtsoManager 
        returns (
            address[] memory _eligibleAddresses,
            uint256[] memory _flrWeights,
            uint256 _flrWeightsSum
        ) 
    {
        FtsoEpoch.Instance storage epoch = _getEpochForFinalization(_epochId);

        uint256 flrTurnout = 0;
        if (epoch.circulatingSupplyFlr > 0) {
            // no overflow - epoch.accumulatedVotePowerFlr is the sum of all WFLRs of voters for given vote power block
            flrTurnout = epoch.accumulatedVotePowerFlr * FtsoEpoch.BIPS100 / epoch.circulatingSupplyFlr;
        }
        
        if (epoch.fallbackMode || flrTurnout <= epoch.lowFlrTurnoutThresholdBIPS) {
            if (!epoch.fallbackMode) {
                emit LowTurnout(_epochId, flrTurnout, epoch.lowFlrTurnoutThresholdBIPS, block.timestamp);
            }
            _averageFinalizePriceEpoch(_epochId, epoch, false);

            // return empty reward data
            return (_eligibleAddresses, _flrWeights, _flrWeightsSum);
        }

        // finalizationType = PriceFinalizationType.WEIGHTED_MEDIAN
        // extract data from epoch votes to memory
        uint256[] memory price;
        uint256[] memory weight;
        uint256[] memory weightFlr;
        (price, weight, weightFlr) = _readVotes(epoch);

        // compute weighted median and truncated quartiles
        uint256[] memory index;
        FtsoMedian.Data memory data;
        (index, data) = FtsoMedian._compute(price, weight);

        // check price deviation
        if (epochs._getPriceDeviation(_epochId, data.finalMedianPrice) > priceDeviationThresholdBIPS) {
            // revert to average price calculation
            _averageFinalizePriceEpoch(_epochId, epoch, false);
            // return empty reward data
            return (_eligibleAddresses, _flrWeights, _flrWeightsSum);
        }

        // store epoch results
        epoch.finalizationType = PriceFinalizationType.WEIGHTED_MEDIAN;
        epoch.price = data.finalMedianPrice; 
        
        // update price
        fAssetPriceUSD = data.finalMedianPrice;
        fAssetPriceTimestamp = block.timestamp;
        
        // return reward data if requested
        bool rewardedFtso = false;
        if (_returnRewardData) {
            (_eligibleAddresses, _flrWeights, _flrWeightsSum) = _readRewardData(epoch, data, index, weightFlr);
            if (_eligibleAddresses.length > 0) {
                rewardedFtso = true;
            }
        }

        // allow saving some informational data (no-op here)
        _writeEpochPriceData(_epochId, data, index, rewardedFtso);

        // inform about epoch result
        emit PriceFinalized(_epochId, epoch.price, rewardedFtso, 
            data.quartile1Price, data.quartile3Price, epoch.finalizationType,
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
        address _priceSubmitter,
        uint256 _firstEpochStartTime,
        uint256 _submitPeriod,
        uint256 _revealPeriod
    ) 
        external override
        onlyFtsoManager
    {
        require(!active, ERR_ALREADY_ACTIVATED);
        priceSubmitter = IPriceSubmitter(_priceSubmitter);
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
    ) 
        external override
        onlyFtsoManager
    {
        require(!active, ERR_ALREADY_ACTIVATED);
        fAssetPriceUSD = _initialPriceUSD;
        fAssetPriceTimestamp = _initialPriceTimestamp;
    }

    /**
     * @notice Sets configurable settings related to epochs
     * @param _maxVotePowerFlrThresholdFraction         high threshold for FLR vote power per voter
     * @param _maxVotePowerAssetThresholdFraction       high threshold for FLR vote power per voter
     * @param _lowAssetUSDThreshold             threshold for low asset vote power
     * @param _highAssetUSDThreshold            threshold for high asset vote power
     * @param _highAssetTurnoutThresholdBIPS    threshold for high asset turnout
     * @param _lowFlrTurnoutThresholdBIPS       threshold for low flr turnout
     * @param _trustedAddresses                 trusted addresses - use their prices if low flr turnout is not achieved
     * @dev Should never revert if called from ftso manager
     */
    function configureEpochs(
        uint256 _maxVotePowerFlrThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowFlrTurnoutThresholdBIPS,
        address[] memory _trustedAddresses
    ) 
        external override
        onlyFtsoManager
    {
        epochs.maxVotePowerFlrThresholdFraction = _maxVotePowerFlrThresholdFraction;
        epochs.maxVotePowerAssetThresholdFraction = _maxVotePowerAssetThresholdFraction;
        epochs.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        epochs.highAssetUSDThreshold = _highAssetUSDThreshold;
        epochs.highAssetTurnoutThresholdBIPS = _highAssetTurnoutThresholdBIPS;
        epochs.lowFlrTurnoutThresholdBIPS = _lowFlrTurnoutThresholdBIPS;

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
            supply.getCirculatingSupplyAtCached(epochs.votePowerBlock),
            _getVotePowerAt(wFlr, epochs.votePowerBlock),
            assets,
            assetVotePowers,
            assetPrices
        );
        
        lastRevealEpochId = epochId;

        emit PriceEpochInitializedOnFtso(epochId, epochs._epochSubmitEndTime(epochId), block.timestamp);
    }
    
    /**
     * @notice Returns current epoch data
     * @return _firstEpochStartTime         First epoch start time
     * @return _submitPeriod                Submit period in seconds
     * @return _revealPeriod                Reveal period in seconds
     */
    function getPriceEpochConfiguration() external view override 
        returns (
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
    function epochsConfiguration() external view override 
        returns (
            uint256 _maxVotePowerFlrThresholdFraction,
            uint256 _maxVotePowerAssetThresholdFraction,
            uint256 _lowAssetUSDThreshold,
            uint256 _highAssetUSDThreshold,
            uint256 _highAssetTurnoutThresholdBIPS,
            uint256 _lowFlrTurnoutThresholdBIPS,
            address[] memory _trustedAddresses
        )
    {
        return (
            epochs.maxVotePowerFlrThresholdFraction,
            epochs.maxVotePowerAssetThresholdFraction,
            epochs.lowAssetUSDThreshold,
            epochs.highAssetUSDThreshold,
            epochs.highAssetTurnoutThresholdBIPS,
            epochs.lowFlrTurnoutThresholdBIPS,
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
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        // only used off-chain, so loop should be ok
        uint256 voteInd = FtsoEpoch._findVoteOf(epoch, _voter);
        if (voteInd == 0) return 0;  // no vote from _voter
        return epoch.votes[voteInd - 1].price;
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
     * @return _fallbackMode            Current epoch in fallback mode - only votes from trusted addresses will be used
     * @dev half-closed intervals - end time not included
     */
    function getPriceEpochData() external view override 
        returns (
            uint256 _epochId,
            uint256 _epochSubmitEndTime,
            uint256 _epochRevealEndTime,
            uint256 _votePowerBlock,
            bool _fallbackMode
        )
    {
        _epochId = getCurrentEpochId();
        _epochSubmitEndTime = epochs._epochSubmitEndTime(_epochId);
        _epochRevealEndTime = _epochSubmitEndTime + epochs.revealPeriod;

        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        _votePowerBlock = epoch.votePowerBlock;
        _fallbackMode = epoch.fallbackMode;
    }

    /**
     * @notice Returns parameters necessary for replicating vote weighting (used in VoterWhitelister).
     * @return _assets                  the list of fAssets that are accounted in vote
     * @return _assetMultipliers        weight multiplier of each asset in (multiasset) ftso
     * @return _totalVotePowerFlr       total FLR vote power at block
     * @return _totalVotePowerAsset     total combined asset vote power at block
     * @return _assetWeightRatio        ratio of combined asset vp vs. FLR vp (in BIPS)
     * @return _votePowerBlock          vote powewr block for given epoch
     */
    function getVoteWeightingParameters() external view override 
        returns (
            IIVPToken[] memory _assets,
            uint256[] memory _assetMultipliers,
            uint256 _totalVotePowerFlr,
            uint256 _totalVotePowerAsset,
            uint256 _assetWeightRatio,
            uint256 _votePowerBlock
        )
    {
        _assets = fAssets;
        if (lastRevealEpochId > 0) {
            FtsoEpoch.Instance storage epoch = epochs.instance[lastRevealEpochId];
            _assetMultipliers = epochs._getAssetVoteMultipliers(epoch);
            _totalVotePowerFlr = epoch.votePowerFlr;
            _totalVotePowerAsset = epoch.votePowerAsset;
            _assetWeightRatio = epoch.baseWeightRatio;
            _votePowerBlock = epoch.votePowerBlock;
        } else {
            // this case might happen on first block, just return some safe params
            // (in this case, only FLR vote powers will be used)
            _assetMultipliers = new uint256[](_assets.length);
            for (uint256 i = 0; i < _assets.length; i++) {
                _assetMultipliers[i] = 0;
            }
            _totalVotePowerFlr = 1;
            _totalVotePowerAsset = 1;
            _assetWeightRatio = 0;
            _votePowerBlock = epochs.votePowerBlock;
        }
    }

    function flrVotePowerCached(address _owner) public override returns (uint256) {
        return _getVotePowerOfAt(wFlr, _owner, epochs.votePowerBlock);
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
    function _revealPrice(
        address _voter, 
        uint256 _epochId, 
        uint256 _price, 
        uint256 _random, 
        uint256 _wflrVP
    ) 
        internal
    {
        require(_price < 2**128, ERR_PRICE_TOO_HIGH);
        require(epochs._epochRevealInProcess(_epochId), ERR_PRICE_REVEAL_FAILURE);
        require(epochVoterHash[_epochId][_voter] == keccak256(abi.encode(_price, _random, _voter)), 
                ERR_PRICE_INVALID);
        // get epoch
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        require(epoch.initializedForReveal || (epoch.fallbackMode && epochs.trustedAddressesMapping[_voter]),
            ERR_EPOCH_NOT_INITIALIZED_FOR_REVEAL);

        // register vote
        (uint256 votePowerFlr, uint256 votePowerAsset) = _getVotePowerOf(epoch, _voter, _wflrVP);
        
        FtsoEpoch._addVote(epoch,
            _voter,
            votePowerFlr,
            votePowerAsset,
            _price,
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
    function _getAssetData() internal 
        returns (
            IIVPToken[] memory _assets,
            uint256[] memory _votePowers,
            uint256[] memory _prices
        )
    {
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
    ) 
        internal
    {
        uint256 _priceSum;
        uint256 _count;
        
        _epoch.trustedAddresses = epochs.trustedAddresses;
        // extract data from epoch trusted votes to memory
        (_priceSum, _count) = _readTrustedVotes(_epoch);
        if (_count > 0) {
            // finalizationType = PriceFinalizationType.TRUSTED_ADDRESSES
            _epoch.price = _priceSum / _count;
            _epoch.finalizationType = _exception ?
                PriceFinalizationType.TRUSTED_ADDRESSES_EXCEPTION : PriceFinalizationType.TRUSTED_ADDRESSES;

            // update price
            fAssetPriceUSD = _epoch.price;
            fAssetPriceTimestamp = block.timestamp;
            
            _writeFallbackEpochPriceData(_epochId);

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
    ) 
        internal
    {
        if (_epochId > 0) {
            _epoch.price = epochs.instance[_epochId - 1].price;
        } else {
            _epoch.price = 0;        
        }
        
        _epoch.finalizationType = _exception ? 
            PriceFinalizationType.PREVIOUS_PRICE_COPIED_EXCEPTION : PriceFinalizationType.PREVIOUS_PRICE_COPIED;

        _writeFallbackEpochPriceData(_epochId);

        emit PriceFinalized(_epochId, _epoch.price, false, 0, 0, _epoch.finalizationType, block.timestamp);
    }

    /**
     * @notice Stores epoch data related to price
     * To be implemented in descendants
     */
    function _writeEpochPriceData(
        uint256 /*_epochId*/,
        FtsoMedian.Data memory /*_data*/, 
        uint256[] memory /*_index*/,
        bool /*rewardedFtso*/
    ) 
        internal virtual
    {
        /* empty block */
    }

    /**
     * @notice Stores epoch data related to price (fallback / low turnout / forced mode)
     * To be implemented in descendants
     */
    function _writeFallbackEpochPriceData(uint256 /*_epochId*/) internal virtual {
    }

    /**
     * @notice Returns FLR and asset vote power for epoch - returns (0, 0) if in fallback mode
     * @param _epoch                Epoch instance
     * @param _owner                Owner address
     * @dev Checks if vote power is sufficient and adjusts vote power if it is too large
     */
    function _getVotePowerOf(FtsoEpoch.Instance storage _epoch, address _owner, uint256 _wflrVP) internal 
        returns (
            uint256 _votePowerFlr,
            uint256 _votePowerAsset
        )
    {
        if (_epoch.fallbackMode) {
            return (0, 0);
        }

        _votePowerFlr = _wflrVP;
        
        _votePowerAsset = _calculateFAssetVotePower(_epoch, _owner);
        
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
            return _vp.totalVotePowerAtCached(_vpBlock);
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

    function _calculateFAssetVotePower(FtsoEpoch.Instance storage _epoch, address _owner) 
        internal 
        returns (uint256 _votePowerAsset)
    {
        uint256[] memory votePowersAsset = new uint256[](_epoch.assets.length);
        for (uint256 i = 0; i < _epoch.assets.length; i++) {
            votePowersAsset[i] = _getVotePowerOfAt(_epoch.assets[i], _owner, _epoch.votePowerBlock);
        }
        _votePowerAsset = epochs._getAssetVotePower(_epoch, votePowersAsset);
    }
        
    /**
     * @notice Extract vote data from epoch
     * @param _epoch                Epoch instance
     */
    function _readVotes(FtsoEpoch.Instance storage _epoch) internal view 
        returns (
            uint256[] memory _price,
            uint256[] memory _weight,
            uint256[] memory _weightFlr
        )
    {
        uint256 length = _epoch.votes.length;

        _price = new uint256[](length);        
        _weightFlr = new uint256[](length);

        uint256[] memory weightAsset = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            FtsoVote.Instance storage v = _epoch.votes[i];
            _price[i] = v.price;
            _weightFlr[i] = v.weightFlr;
            weightAsset[i] = v.weightAsset;
        }

        _weight = FtsoEpoch._computeWeights(_epoch, _weightFlr, weightAsset);
    }

    /**
     * @notice Extract trusted vote data from epoch
     * @param _epoch                Epoch instance
     * @return _priceSum            Sum of all prices submitted by trusted addresses
     * @return _count               Number of prices submitted by trusted addresses
     */
    function _readTrustedVotes(FtsoEpoch.Instance storage _epoch) internal view 
        returns (
            uint256 _priceSum,
            uint256 _count
        )
    {
        address[] memory trustedAddresses = _epoch.trustedAddresses;
        uint256 length = _epoch.votes.length;

        for (uint256 i = 0; i < length; i++) {
            address voter = _epoch.votes[i].voter;
            for (uint256 j = 0; j < trustedAddresses.length; j++) {
                if (voter == trustedAddresses[j]) {
                    _priceSum += _epoch.votes[i].price;     // no overflow as v.price < 2**128
                    _count++;
                }
            }
        }
    }

    /**
     * @notice Extracts reward data for epoch
     * @param _epoch                The epoch instance to read data from
     * @param _data                 Median computation data
     * @param _index                Array of vote indices
     * @param _weightFlr            Array of FLR weights
     */
    function _readRewardData(
        FtsoEpoch.Instance storage _epoch,
        FtsoMedian.Data memory _data,
        uint256[] memory _index, 
        uint256[] memory _weightFlr
    ) 
        internal view
        returns (
            address[] memory _eligibleAddresses, 
            uint256[] memory _flrWeights,
            uint256 _flrWeightsSum
        )
    {
        uint256 random = _epoch.random;
        uint256 voteRewardCount = 0;
        for (uint256 i = _data.quartile1Index; i <= _data.quartile3Index; i++) {
            uint256 idx = _index[i];
            if (_weightFlr[idx] > 0) {
                uint128 price = _epoch.votes[idx].price;
                if ((price == _data.quartile1Price || price == _data.quartile3Price) &&
                    ! _isAddressEligible(random, _epoch.votes[idx].voter)) {
                        continue;
                }
                voteRewardCount++;
            }
        }

        _eligibleAddresses = new address[](voteRewardCount);
        _flrWeights = new uint256[](voteRewardCount);
        uint256 cnt = 0;
        for (uint256 i = _data.quartile1Index; i <= _data.quartile3Index; i++) {
            uint256 idx = _index[i];
            uint256 weight = _weightFlr[idx];
            if (weight > 0) {
                uint128 price = _epoch.votes[idx].price;
                if ((price == _data.quartile1Price || price == _data.quartile3Price) &&
                    ! _isAddressEligible(random, _epoch.votes[idx].voter)) {
                    continue;
                }
                _eligibleAddresses[cnt] = _epoch.votes[idx].voter;
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

    /**
     * @notice Checks if an address is eligible for reward (for edge quartile cases)
     * @param _random               Current random for this Ftso
     * @param _address              Address that submitted the price
     * @return _eligible            Return True if the address should be rewarded
     */
    function _isAddressEligible(uint256 _random, address _address) internal pure returns (bool _eligible) {
        _eligible = ((uint256(keccak256(abi.encode(_random, _address))) % 2) == 1);
    }

    function revertNoAccess() internal pure {
        revert(ERR_NO_ACCESS);
    } 

    function revertNotActive() internal pure {
        revert(ERR_NOT_ACTIVE);
    } 
}
