// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIFtsoManager.sol";
import "../interface/IIFtsoRewardManager.sol";
import "../../genesis/interface/IFlareKeep.sol";
import "../interface/IIFtso.sol";
import "../../genesis/implementation/FlareKeeper.sol";
import "../../genesis/interface/IIFtsoRegistry.sol";
import "../../genesis/interface/IIPriceSubmitter.sol";
import "../../utils/implementation/GovernedAndFlareKept.sol";
import "../../governance/implementation/Governed.sol";
import "../lib/FtsoManagerSettings.sol";
import "../../utils/implementation/RevertErrorTracking.sol";
import "../../token/implementation/CleanupBlockNumberManager.sol";

/**
 * FtsoManager is in charge of:
 * - defining reward epochs (few days)
 * - per reward epoch choose a single block that represents vote power of this epoch.
 * - keep track of all FTSO contracts
 * - per price epoch (few minutes)
 *    - randomly choose one FTSO for rewarding.
 *    - trigger finalize price reveal epoch
 *    - determines addresses and reward weights and triggers rewardDistribution
 */    
contract FtsoManager is IIFtsoManager, GovernedAndFlareKept, IFlareKeep, RevertErrorTracking {
    using FtsoManagerSettings for FtsoManagerSettings.State;

    struct PriceEpochData {
        address chosenFtso;
        uint256 rewardEpochId;
        bool rewardDistributed;
    }

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
        uint256 startTimestamp;
    }

    string internal constant ERR_FIRST_EPOCH_START_TS_IN_FUTURE = "First epoch start timestamp in future";
    string internal constant ERR_REWARD_EPOCH_DURATION_ZERO = "Reward epoch 0";
    string internal constant ERR_PRICE_EPOCH_DURATION_ZERO = "Price epoch 0";
    string internal constant ERR_REVEAL_PRICE_EPOCH_DURATION_ZERO = "Reveal price epoch 0";
    string internal constant ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "Gov. params not initialized";
    string internal constant ERR_GOV_PARAMS_INVALID = "Gov. params invalid";
    string internal constant ERR_FASSET_FTSO_NOT_MANAGED = "FAsset FTSO not managed by ftso manager";
    string internal constant ERR_NOT_FOUND = "Not found";
    string internal constant ERR_ALREADY_ADDED = "Already added";
    string internal constant ERR_FTSO_FASSET_FTSO_ZERO = "fAsset ftsos list empty";
    string internal constant ERR_FTSO_EQUALS_FASSET_FTSO = "ftso equals fAsset ftso";
    string internal constant ERR_FTSO_SYMBOLS_MUST_MATCH = "FTSO symbols must match";
    string internal constant ERR_REWARD_EXPIRY_OFFSET_INVALID = "Reward expiry invalid";

    bool public override active;
    RewardEpochData[] public rewardEpochs;

    mapping(uint256 => PriceEpochData) public priceEpochs;
    FtsoManagerSettings.State public settings;

    // price epoch data
    uint256 immutable internal firstPriceEpochStartTs;
    uint256 immutable internal priceEpochDurationSec;
    uint256 immutable internal revealEpochDurationSec;
    uint256 public lastUnprocessedPriceEpoch;
    uint256 internal lastUnprocessedPriceEpochEnds;
    uint256 internal currentPriceEpochEnds;

    // reward Epoch data
    uint256 internal currentRewardEpoch;
    uint256 immutable public rewardEpochDurationSec;
    uint256 immutable public rewardEpochsStartTs;
    uint256 internal currentRewardEpochEnds;
    uint256 internal votePowerBoundaryFraction;
    uint256 internal nextRewardEpochToExpire;


    mapping(IIFtso => bool) internal managedFtsos;
    IIFtsoRewardManager internal rewardManager;
    IIPriceSubmitter internal immutable priceSubmitter;

    IIFtsoRegistry public immutable override ftsoRegistry;

    CleanupBlockNumberManager public cleanupBlockNumberManager;

    // flags
    bool private justStarted;

    // fallback mode
    bool public fallbackMode; // all ftsos in fallback mode
    mapping(IIFtso => bool) public ftsoInFallbackMode;

    // Testing information:
    // IIPriceSubmitter should be a new contract for a new deploy or at least
    // _priceEpochDurationSec, _firstEpochStartTs and _revealEpochDurationSec must match
    constructor(
        address _governance,
        FlareKeeper _flareKeeper,
        IIFtsoRewardManager _rewardManager,
        IIPriceSubmitter _priceSubmitter,
        IIFtsoRegistry _ftsoRegistry,
        uint256 _priceEpochDurationSec,
        uint256 _firstEpochStartTs,
        uint256 _revealEpochDurationSec,
        uint256 _rewardEpochDurationSec,
        uint256 _rewardEpochsStartTs,
        uint256 _votePowerBoundaryFraction
    ) GovernedAndFlareKept(_governance, _flareKeeper){
        require(block.timestamp >= _firstEpochStartTs, ERR_FIRST_EPOCH_START_TS_IN_FUTURE);
        require(_rewardEpochDurationSec > 0, ERR_REWARD_EPOCH_DURATION_ZERO);
        require(_priceEpochDurationSec > 0, ERR_PRICE_EPOCH_DURATION_ZERO);
        require(_revealEpochDurationSec > 0, ERR_REVEAL_PRICE_EPOCH_DURATION_ZERO);

        // reward epoch
        rewardEpochDurationSec = _rewardEpochDurationSec;
        currentRewardEpoch = 0;
        rewardEpochsStartTs = _rewardEpochsStartTs;
        currentRewardEpochEnds = _rewardEpochsStartTs + _rewardEpochDurationSec;

        // price epoch
        firstPriceEpochStartTs = _firstEpochStartTs;
        priceEpochDurationSec = _priceEpochDurationSec;
        revealEpochDurationSec = _revealEpochDurationSec;
        lastUnprocessedPriceEpoch = (block.timestamp - _firstEpochStartTs) / _priceEpochDurationSec;
        lastUnprocessedPriceEpochEnds = 
            _firstEpochStartTs + ((lastUnprocessedPriceEpoch + 1) * _priceEpochDurationSec);
        currentPriceEpochEnds = lastUnprocessedPriceEpochEnds;

        votePowerBoundaryFraction = _votePowerBoundaryFraction;
        rewardManager = _rewardManager;
        priceSubmitter = _priceSubmitter;
        ftsoRegistry = _ftsoRegistry;

        justStarted = true;
    }

    /**
     * @notice Sets history cleanup manager.
     */
    function setCleanupBlockNumberManager(
        CleanupBlockNumberManager _cleanupBlockNumberManager
    ) external onlyGovernance {
        cleanupBlockNumberManager = _cleanupBlockNumberManager;
    }
    
    /**
     * @notice Activates FTSO manager (keep() runs jobs)
     */
    function activate() external override onlyGovernance {
        active = true;
    }

    /**
     * @notice Deactivates FTSO manager (keep() stops running jobs)
     */
    function deactivate() external override onlyGovernance {
        active = false;
    }

    /**
     * @notice Runs task triggered by Keeper.
     * The tasks include the following by priority
     * - finalizePriceEpoch     
     * - Set governance parameters and initialize epochs
     * - finalizeRewardEpoch 
     */
    function keep() external override onlyFlareKeeper returns (bool) {
        // flare keeper trigger. once every block
        
        // TODO: remove this event after testing phase
        emit KeepTrigger(block.number, block.timestamp);
        if (!active) return false;

        IIFtso[] memory _ftsos = _getFtsos();

        if (justStarted) {
            _initializeRewardEpoch(_ftsos);
        } else {
            if (lastUnprocessedPriceEpochEnds < rewardEpochsStartTs) {
                // Force closing ftsos before start of the first reward epoch
                _forceFinalizePriceEpochBeforeRewardEpochStarts(_ftsos);
            } else if (lastUnprocessedPriceEpochEnds + revealEpochDurationSec <= block.timestamp) {
                // finalizes price epoch, completely finalizes reward epoch
                _finalizePriceEpoch(_ftsos);
            }
            // Note: Expired reward offset should be determined and set before finalizing reward epoch
            // _manageExpiringRewardEpochs();            
            // Note: prices should be first finalized and then new reward epoch can start
            if (currentRewardEpochEnds <= block.timestamp) {
                _finalizeRewardEpoch(_ftsos);
                _closeExpiredRewardEpochs();
                _cleanupOnRewardEpochFinalization();
            }

            if(currentPriceEpochEnds <= block.timestamp) {
                // sets governance parameters on ftsos
                _initializeCurrentEpochFTSOStatesForReveal(_ftsos);
            }
        }
        return true;
    }

     /**
     * @notice Adds FTSO to the list of rewarded FTSOs
     * All ftsos in multi fasset ftso must be managed by this ftso manager
     */
    function addFtso(IIFtso _ftso) external override onlyGovernance {
        _addFtso(_ftso, true);
    }

    /**
     * @notice Removes FTSO from the list of the rewarded FTSOs - revert if ftso is used in multi fasset ftso
     * @dev Deactivates _ftso
     */
    function removeFtso(IIFtso _ftso) external override onlyGovernance {
        uint256 ftsoIndex = ftsoRegistry.getFtsoIndex(_ftso.symbol());
        priceSubmitter.removeFtso(_ftso, ftsoIndex);
        ftsoRegistry.removeFtso(_ftso);
        _cleanFtso(_ftso);
    }
    
    /**
     * @notice Replaces one ftso with another - symbols must match
     * All ftsos in multi fasset ftso must be managed by this ftso manager
     * @dev Deactivates _ftsoToRemove
     */
    function replaceFtso(
        IIFtso _ftsoToRemove,
        IIFtso _ftsoToAdd,
        bool _copyCurrentPrice,
        bool _copyFAssetOrFAssetFtsos
    ) external override onlyGovernance {
        // should compare strings but it is not supported - comparing hashes instead
        require(keccak256(abi.encode(_ftsoToRemove.symbol())) == keccak256(abi.encode(_ftsoToAdd.symbol())), 
            ERR_FTSO_SYMBOLS_MUST_MATCH);

        // Check if it already exists
        IIFtso[] memory availableFtsos = ftsoRegistry.getSupportedFtsos();
        uint256 len = availableFtsos.length;
        uint256 k = 0;
        while(k < len){
            if(availableFtsos[k] == _ftsoToRemove){
                break;
            }
            ++k;
        }
        if(k == len){
            revert(ERR_NOT_FOUND);
        }


        if (_copyCurrentPrice) {
            (uint256 currentPrice, uint256 timestamp) = _ftsoToRemove.getCurrentPrice();
            _ftsoToAdd.updateInitialPrice(currentPrice, timestamp);
        }

        if (_copyFAssetOrFAssetFtsos) {
            IIVPToken fAsset = _ftsoToRemove.getFAsset();
            if (address(fAsset) != address(0)) { // copy fAsset if exists
                _ftsoToAdd.setFAsset(fAsset);
            } else { // copy fAssetFtsos list if not empty
                IIFtso[] memory fAssetFtsos = _ftsoToRemove.getFAssetFtsos();
                if (fAssetFtsos.length > 0) {
                    _ftsoToAdd.setFAssetFtsos(fAssetFtsos);
                }
            }
        }
        // Add without duplicate check
        _addFtso(_ftsoToAdd, false);
        
        // replace old contract with the new one in multi fAsset ftsos
        IIFtso[] memory contracts = ftsoRegistry.getSupportedFtsos();

        uint256 ftsosLen = contracts.length;
        for (uint256 i = 0; i < ftsosLen; i++) {
            IIFtso ftso = contracts[i];
            if (ftso == _ftsoToRemove) {
                continue;
            }
            IIFtso[] memory fAssetFtsos = ftso.getFAssetFtsos();
            uint256 fAssetFtsosLen = fAssetFtsos.length;
            if (fAssetFtsosLen > 0) {
                bool changed = false;
                for (uint256 j = 0; j < fAssetFtsosLen; j++) {
                    if (fAssetFtsos[j] == _ftsoToRemove) {
                        fAssetFtsos[j] = _ftsoToAdd;
                        changed = true;
                    }
                }
                if (changed) {
                    ftso.setFAssetFtsos(fAssetFtsos);
                }
            }
        }

        // cleanup old contract
        _cleanFtso(_ftsoToRemove);
    }
    
    /**
     * @notice Set FAsset for FTSO
     */
    function setFtsoFAsset(IIFtso _ftso, IIVPToken _fAsset) external override onlyGovernance {
        _ftso.setFAsset(_fAsset);
    }

    /**
     * @notice Set FAsset FTSOs for FTSO - all ftsos should already be managed by this ftso manager
     */
    function setFtsoFAssetFtsos(IIFtso _ftso, IIFtso[] memory _fAssetFtsos) external override onlyGovernance {
        uint256 len = _fAssetFtsos.length;
        require (len > 0, ERR_FTSO_FASSET_FTSO_ZERO);
        for (uint256 i = 0; i < len; i++) {
            if (_ftso == _fAssetFtsos[i]) {
                revert(ERR_FTSO_EQUALS_FASSET_FTSO);
            }
        }

        _checkFAssetFtsosAreManaged(_fAssetFtsos);
        _ftso.setFAssetFtsos(_fAssetFtsos);
    }

    /**
     * @notice Set fallback mode
     */
    function setFallbackMode(bool _fallbackMode) external override onlyGovernance {
        fallbackMode = _fallbackMode;
        emit FallbackMode(_fallbackMode);
    }

    /**
     * @notice Set fallback mode for ftso
     */
    function setFtsoFallbackMode(IIFtso _ftso, bool _fallbackMode) external override onlyGovernance {
        require(managedFtsos[_ftso], ERR_NOT_FOUND);
        ftsoInFallbackMode[_ftso] = _fallbackMode;
        emit FtsoFallbackMode(_ftso, _fallbackMode);
    }

    /**
     * @notice Sets governance parameters for FTSOs
     */
    function setGovernanceParameters(
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutBIPSThreshold,
        uint256 _lowFlrTurnoutBIPSThreshold,
        uint256 _rewardExpiryOffsetSeconds,
        address[] memory _trustedAddresses
    ) external override onlyGovernance {
        require(_maxVotePowerFlrThreshold > 0, ERR_GOV_PARAMS_INVALID);
        require(_maxVotePowerAssetThreshold > 0, ERR_GOV_PARAMS_INVALID);
        require(_highAssetUSDThreshold >= _lowAssetUSDThreshold, ERR_GOV_PARAMS_INVALID);
        require(_highAssetTurnoutBIPSThreshold <= 1e4, ERR_GOV_PARAMS_INVALID);
        require(_lowFlrTurnoutBIPSThreshold <= 1e4, ERR_GOV_PARAMS_INVALID);
        require(_rewardExpiryOffsetSeconds > 600, ERR_REWARD_EXPIRY_OFFSET_INVALID);
        settings._setState(
            _maxVotePowerFlrThreshold,
            _maxVotePowerAssetThreshold,
            _lowAssetUSDThreshold,
            _highAssetUSDThreshold,
            _highAssetTurnoutBIPSThreshold,
            _lowFlrTurnoutBIPSThreshold,
            _rewardExpiryOffsetSeconds,
            _trustedAddresses
        );
    }
    
    function getPriceSubmitter() external view override returns (IPriceSubmitter){
        return priceSubmitter;
    }

    /**
     * @notice Returns current reward epoch index (one currently running)
     */
    function getCurrentRewardEpoch() external view override returns (uint256) {
        return currentRewardEpoch;
    }

    /**
     * @dev half-closed intervals - end time not included
     */
    function getCurrentPriceEpochData() external view override returns (
        uint256 priceEpochId,
        uint256 priceEpochStartTimestamp,
        uint256 priceEpochEndTimestamp,
        uint256 priceEpochRevealEndTimestamp,
        uint256 currentTimestamp
    ) {
        uint256 epochId = _getCurrentPriceEpochId();
        return (
            epochId,
            firstPriceEpochStartTs + epochId * priceEpochDurationSec,
            firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSec,
            firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSec + revealEpochDurationSec,
            block.timestamp
        );
    }
    
    /**
     * @notice Gets vote power block of the specified reward epoch
     * @param _rewardEpoch          Reward epoch sequence number
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view override returns (uint256) {
        return rewardEpochs[_rewardEpoch].votepowerBlock;
    }

    /*
     * @notice Returns the list of FTSOs
     */
    function getFtsos() external view override returns (IIFtso[] memory _ftsos) {
        return _getFtsos();
    }

    function getPriceEpochConfiguration() external view override returns (
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSec,
        uint256 _revealEpochDurationSec
    ) {
        return (firstPriceEpochStartTs, priceEpochDurationSec, revealEpochDurationSec);
    }

    function _addFtso(IIFtso _ftso, bool _updatingExistingFtso) internal {
        require(settings.initialized, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);

        _checkFAssetFtsosAreManaged(_ftso.getFAssetFtsos());

        if(_updatingExistingFtso){
            // Check if it already exists
            IIFtso[] memory availableFtsos = ftsoRegistry.getSupportedFtsos();
            uint256 len = availableFtsos.length;
            while(len > 0){
                --len;
                if(availableFtsos[len] == _ftso){
                    revert(ERR_ALREADY_ADDED);
                }
            }
        }

        _ftso.activateFtso(priceSubmitter, firstPriceEpochStartTs, priceEpochDurationSec, revealEpochDurationSec);

        // Set the vote power block
        if(!justStarted) {
            _ftso.setVotePowerBlock(rewardEpochs[currentRewardEpoch].votepowerBlock);
        }

        // Configure 
        _ftso.configureEpochs(
            settings.maxVotePowerFlrThreshold,
            settings.maxVotePowerAssetThreshold,
            settings.lowAssetUSDThreshold,
            settings.highAssetUSDThreshold,
            settings.highAssetTurnoutBIPSThreshold,
            settings.lowFlrTurnoutBIPSThreshold,
            settings.trustedAddresses
        );
        
        managedFtsos[_ftso] = true;
        ftsoRegistry.addFtso(_ftso);

        if(!_updatingExistingFtso){
            uint256 ftsoIndex = ftsoRegistry.getFtsoIndex(_ftso.symbol());      
            priceSubmitter.addFtso(_ftso, ftsoIndex);
        }
        
        emit FtsoAdded(_ftso, true);
    }

    function _cleanFtso(IIFtso _ftso) internal {
        _ftso.deactivateFtso();
        // Since this is as mapping, we can also just delete it, as false is default value for non-existing keys
        delete ftsoInFallbackMode[_ftso];
        delete managedFtsos[_ftso];
        _checkMultiFassetFtsosAreManaged(_getFtsos());
        emit FtsoAdded(_ftso, false);
    }

    /**
     * @notice Initializes reward epochs. Also sets vote power block to FTSOs
     */
    function _initializeRewardEpoch(IIFtso[] memory _ftsos) internal {
        if (block.timestamp >= currentRewardEpochEnds - rewardEpochDurationSec) {
            uint256 numFtsos = _ftsos.length;
            // Prime the reward epoch array with a new reward epoch
            RewardEpochData memory epochData = RewardEpochData({
                votepowerBlock: block.number - 1,
                startBlock: block.number,
                startTimestamp: block.timestamp
            });

            rewardEpochs.push(epochData);
            currentRewardEpoch = 0;

            for (uint256 i = 0; i < numFtsos; ++i) {
                _ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
            }
            justStarted = false;
        }
    }

    /**
     * @notice Finalizes reward epoch
     */
    function _finalizeRewardEpoch(IIFtso[] memory _ftsos) internal {
        uint256 numFtsos = _ftsos.length;

        uint256 lastRandom = block.timestamp;
        // Are there any FTSOs to process?
        if (numFtsos > 0) {
            for (uint256 i = 0; i < numFtsos; ++i) {
                lastRandom += _ftsos[i].getCurrentRandom();
            }
        }

        lastRandom = uint256(keccak256(abi.encode(lastRandom)));
        // @dev when considering block boundary for vote power block:
        // - if far from now, it doesn't reflect last vote power changes
        // - if too small, possible loan attacks.     
        // IMPORTANT: currentRewardEpoch is actually the one just geting finalized!
        uint256 votepowerBlockBoundary = 
            (block.number - rewardEpochs[currentRewardEpoch].startBlock) / 
              (votePowerBoundaryFraction == 0 ? 1 : votePowerBoundaryFraction);
        // additional notice: if someone sets votePowerBoundaryFraction to 0
        // this would cause division by 0 and effectively revert would halt the system
 
        if(votepowerBlockBoundary == 0) {
            votepowerBlockBoundary = 1;
        }
 
        //slither-disable-next-line weak-prng           // lastRandom calculated from ftso inputs
        uint256 votepowerBlocksAgo = lastRandom % votepowerBlockBoundary;
        // prevent block.number becoming votePowerBlock
        // if  lastRandom % votepowerBlockBoundary == 0  
        if (votepowerBlocksAgo == 0) {
            votepowerBlocksAgo = 1;
        }
        
        RewardEpochData memory epochData = RewardEpochData({
            votepowerBlock: block.number - votepowerBlocksAgo, 
            startBlock: block.number,
            startTimestamp: block.timestamp
        });
        rewardEpochs.push(epochData);
        currentRewardEpoch = rewardEpochs.length - 1;
        for (uint256 i = 0; i < numFtsos; i++) {
            _ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
        }

        emit RewardEpochFinalized(epochData.votepowerBlock, epochData.startBlock);

        // Advance end-time
        currentRewardEpochEnds += rewardEpochDurationSec;
    }

    /**
     * @notice Closes expired reward epochs
     */
    function _closeExpiredRewardEpochs() internal {
        uint256 expiryThreshold = block.timestamp - settings.rewardExpiryOffsetSeconds;
        // NOTE: start time of (i+1)th reward epoch is the end time of i-th  
        // This loop is clearly bounded by the value currentRewardEpoch, which is
        // always kept to the value of rewardEpochs.length - 1 in code and this value
        // does not change in the loop.  
        while(
            nextRewardEpochToExpire < currentRewardEpoch && 
            rewardEpochs[nextRewardEpochToExpire + 1].startTimestamp <= expiryThreshold) 
        {   // Note: Since nextRewardEpochToExpire + 1 starts at that time
            // nextRewardEpochToExpire ends strictly before expiryThreshold, 
            try rewardManager.closeExpiredRewardEpoch(nextRewardEpochToExpire, currentRewardEpoch) {
                nextRewardEpochToExpire++;
            } catch Error(string memory message) {
                // closing of expired failed, which is not critical
                // just emit event for diagnostics
                emit ClosingExpiredRewardEpochFailed(nextRewardEpochToExpire);
                addRevertError(address(this),message);
                // Do not proceed with the loop.
                break;
            }                    
        }
    }

    /**
     * @notice Performs any cleanup needed immediately after a reward epoch is finalized
     */
    function _cleanupOnRewardEpochFinalization() internal {
        if(address(cleanupBlockNumberManager) == address(0)) {
            emit CleanupBlockNumberManagerUnset();
            return;
        }
        uint256 cleanupBlock = rewardEpochs[nextRewardEpochToExpire].votepowerBlock;
        
        try cleanupBlockNumberManager.setCleanUpBlockNumber(cleanupBlock) {
        } catch Error(string memory message) {
            // closing of expired failed, which is not critical
            // just emit event for diagnostics
            emit CleanupBlockNumberManagerFailedForBlock(cleanupBlock);
            addRevertError(address(this),message);
        }        
    }

    /**
     * @notice Force finalizes price epochs that expired before reward epochs start
     */
    function _forceFinalizePriceEpochBeforeRewardEpochStarts(IIFtso[] memory _ftsos) internal {
        uint256 numFtsos = _ftsos.length;
        if(numFtsos > 0) {
            for(uint256 i = 0; i < numFtsos; i++) {
                try _ftsos[i].forceFinalizePriceEpoch(lastUnprocessedPriceEpoch) {
                } catch Error(string memory message) {
                    emit FinalizingPriceEpochFailed(_ftsos[i], lastUnprocessedPriceEpoch);
                    addRevertError(address(this),message);
                }
            }
        }
        lastUnprocessedPriceEpoch++;
        lastUnprocessedPriceEpochEnds += priceEpochDurationSec;
    }
    /**
     * @notice Finalizes price epoch
     */
    function _finalizePriceEpoch(IIFtso[] memory _ftsos) internal {
        uint256 numFtsos = _ftsos.length;

        // Are there any FTSOs to process?
        if(numFtsos > 0) {
            // choose winning ftso
            uint256 chosenFtsoId;
            if (lastUnprocessedPriceEpoch == 0 || priceEpochs[lastUnprocessedPriceEpoch-1].chosenFtso == address(0)) {
                // pump not yet primed
                //slither-disable-next-line weak-prng           // only used for first epoch
                chosenFtsoId = uint256(keccak256(abi.encode(
                        block.difficulty, block.timestamp
                    ))) % numFtsos;
            } else {
                // at least one finalize with real FTSO
                uint256 currentRandomSum = 0;
                for(uint256 i = 0; i < numFtsos; i++) {
                    currentRandomSum += _ftsos[i].getCurrentRandom(); // may overflow but it is still ok
                }
                //slither-disable-next-line weak-prng           // ftso random calculated safely from inputs
                chosenFtsoId = uint256(keccak256(abi.encode(
                        currentRandomSum, block.timestamp
                    ))) % numFtsos;
            }
            address[] memory addresses;
            uint256[] memory weights;
            uint256 totalWeight;

            // On the off chance that the winning FTSO does not have any
            // recipient within the truncated price distribution to
            // receive rewards, find the next FTSO that does have reward
            // recipients and declare it the winner. Start with the next ftso.
            bool wasDistributed = false;
            address rewardedFtsoAddress = address(0);
            for(uint256 i = 0; i < numFtsos; i++) {
                //slither-disable-next-line weak-prng           // not a random, just choosing next
                uint256 id = (chosenFtsoId + i) % numFtsos;
                try _ftsos[id].finalizePriceEpoch(lastUnprocessedPriceEpoch, !wasDistributed) returns (
                    address[] memory _addresses,
                    uint256[] memory _weights,
                    uint256 _totalWeight
                ) {
                    if (!wasDistributed && _addresses.length > 0) { // change also in FTSO if condition changes
                        (addresses, weights, totalWeight) = (_addresses, _weights, _totalWeight);
                        wasDistributed = true;
                        rewardedFtsoAddress = address(_ftsos[id]);
                    }
                } catch {
                    try _ftsos[id].averageFinalizePriceEpoch(lastUnprocessedPriceEpoch) {
                    } catch {
                        try _ftsos[id].forceFinalizePriceEpoch(lastUnprocessedPriceEpoch) {
                        } catch Error(string memory message) {
                            emit FinalizingPriceEpochFailed(_ftsos[id], lastUnprocessedPriceEpoch);
                            addRevertError(address(this),message);
                        }
                    }
                }
            }

            priceEpochs[lastUnprocessedPriceEpoch] = PriceEpochData({
                chosenFtso: rewardedFtsoAddress,
                rewardEpochId: currentRewardEpoch,
                rewardDistributed: false
            });

            if (wasDistributed) {
                try rewardManager.distributeRewards(
                    addresses, weights, totalWeight,
                    lastUnprocessedPriceEpoch, rewardedFtsoAddress,
                    priceEpochDurationSec,
                    currentRewardEpoch,
                    _getPriceEpochEndTime(lastUnprocessedPriceEpoch) - 1, // actual end time (included)
                    rewardEpochs[currentRewardEpoch].votepowerBlock)
                {
                    priceEpochs[lastUnprocessedPriceEpoch].rewardDistributed = true;
                } catch Error(string memory message) {
                    emit DistributingRewardsFailed(rewardedFtsoAddress, lastUnprocessedPriceEpoch);
                    addRevertError(address(this),message);
                }
            }

            emit PriceEpochFinalized(rewardedFtsoAddress, currentRewardEpoch);
        } else {
            priceEpochs[lastUnprocessedPriceEpoch] = PriceEpochData({
                chosenFtso: address(0),
                rewardEpochId: currentRewardEpoch,
                rewardDistributed: false
            });

            emit PriceEpochFinalized(address(0), currentRewardEpoch);
        }      
        // Advance to next price epoch
        // Note: lastUnprocessedPriceEpoch <= ftso.getCurrentEpochId()
        lastUnprocessedPriceEpoch++;
        lastUnprocessedPriceEpochEnds += priceEpochDurationSec;
    }
    
    /**
     * @notice Initializes epoch states in FTSOs for reveal. 
     * Prior to initialization it sets governance parameters, if 
     * governance has changed them.
     */
    function _initializeCurrentEpochFTSOStatesForReveal(IIFtso[] memory _ftsos) internal {
        uint256 numFtsos = _ftsos.length;
        for (uint256 i = 0; i < numFtsos; i++) {
            if(settings.changed) {
                _ftsos[i].configureEpochs(
                    settings.maxVotePowerFlrThreshold,
                    settings.maxVotePowerAssetThreshold,
                    settings.lowAssetUSDThreshold,
                    settings.highAssetUSDThreshold,
                    settings.highAssetTurnoutBIPSThreshold,
                    settings.lowFlrTurnoutBIPSThreshold,
                    settings.trustedAddresses
                );
            }

            try _ftsos[i].initializeCurrentEpochStateForReveal(fallbackMode || ftsoInFallbackMode[_ftsos[i]]) {
            } catch Error(string memory message) {
                emit InitializingCurrentEpochStateForRevealFailed(_ftsos[i], _getCurrentPriceEpochId());
                addRevertError(address(this),message);
            }
        }
        settings.changed = false;

        currentPriceEpochEnds = _getCurrentPriceEpochEndTime();
    }
    
    /**
     * @notice Check if fasset ftsos are managed by this ftso manager, revert otherwise
     */
    function _checkFAssetFtsosAreManaged(IIFtso[] memory _fAssetFtsos) internal view {
        uint256 len = _fAssetFtsos.length;
        for (uint256 i = 0; i < len; i++) {
            if (!managedFtsos[_fAssetFtsos[i]]) {
                revert(ERR_FASSET_FTSO_NOT_MANAGED);
            }
        }
    }

    /**
     * @notice Check if all multi fasset ftsos are managed by this ftso manager, revert otherwise
     */
    function _checkMultiFassetFtsosAreManaged(IIFtso[] memory _ftsos) internal view {
        uint256 len = _ftsos.length;
        for (uint256 i = 0; i < len; i++) {
            _checkFAssetFtsosAreManaged(_ftsos[i].getFAssetFtsos());
        }
    }

    /**
     * @notice Returns current price epoch end time.
     * @dev half-closed interval - end time not included
     */
    function _getCurrentPriceEpochEndTime() internal view returns (uint256) {
        uint256 currentPriceEpoch = _getCurrentPriceEpochId();
        return firstPriceEpochStartTs + (currentPriceEpoch + 1) * priceEpochDurationSec;
    }

    /**
     * @notice Returns price epoch end time.
     * @param _forPriceEpochId The price epoch id of the end time to fetch.
     * @dev half-closed interval - end time not included
     */
    function _getPriceEpochEndTime(uint256 _forPriceEpochId) internal view returns (uint256) {
        return firstPriceEpochStartTs + ((_forPriceEpochId + 1) * priceEpochDurationSec);
    }

    /**
     * @notice Returns current price epoch id. The calculation in this function
     * should fully match to definition of current epoch id in FTSO contracts.
     */
    function _getCurrentPriceEpochId() internal view returns (uint256) {
        return (block.timestamp - firstPriceEpochStartTs) / priceEpochDurationSec;
    }

    function _getFtsos() private view returns (IIFtso[] memory) {
        return ftsoRegistry.getSupportedFtsos();
    }
}
