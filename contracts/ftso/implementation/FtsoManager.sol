// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { FtsoInflationAuthorizer } from "../../inflation/implementation/FtsoInflationAuthorizer.sol";
import "../../userInterfaces/IFtsoManager.sol";
import "../../interfaces/IRewardManager.sol";
import "../../interfaces/IFlareKeep.sol";
import "../interface/IIFtso.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../../governance/implementation/Governed.sol";
import "../interface/IIFtsoManager.sol";
import "../lib/FtsoManagerSettings.sol";
//import "hardhat/console.sol";

/**
 * FtsoManager is in charge of:
 * - defining reward epochs (~2-7 days)
 * - per reward epoch choose a single block that represents vote power of this epoch.
 * - keep track of all FTSO contracts
 * - per price epoch (~2 minutes)
 *    - randomly choose one FTSO for rewarding.
 *    - trigger finalize price reveal epoch
 *    - determines addresses and reward weights and triggers rewardDistribution on RewardManager
 */    
contract FtsoManager is IIFtsoManager, IFlareKeep, Governed {
    using FtsoManagerSettings for FtsoManagerSettings.State;

    struct PriceEpochData {
        address chosenFtso;
        uint256 rewardEpochId;
        bool rewardDistributed;
    }

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
    }

    string internal constant ERR_REWARD_EPOCH_DURATION_ZERO = "Reward epoch 0";
    string internal constant ERR_PRICE_EPOCH_DURATION_ZERO = "Price epoch 0";
    string internal constant ERR_REVEAL_PRICE_EPOCH_DURATION_ZERO = "Reveal price epoch 0";
    string internal constant ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "Gov. params not initialized";
    string internal constant ERR_GOV_PARAMS_INVALID = "Gov. params invalid";
    string internal constant ERR_FASSET_FTSO_NOT_MANAGED = "FAsset FTSO not managed by ftso manager";
    string internal constant ERR_NOT_FOUND = "Not found";

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

    // list of ftsos eligible for reward
    IIFtso[] internal ftsos;
    mapping(IIFtso => bool) internal managedFtsos;
    IRewardManager internal rewardManager;
    IPriceSubmitter public immutable override priceSubmitter;
    FtsoInflationAuthorizer internal ftsoInflationAuthorizer;

    // flags
    bool private justStarted;

    // panic mode
    bool public panicMode; // all ftsos in panic mode
    mapping(IIFtso => bool) public ftsoInPanicMode;

    // IPriceSubmitter should be a new contract for a new deploy or at least
    // _priceEpochDurationSec, _firstEpochStartTs and _revealEpochDurationSec must match
    constructor(
        address _governance,
        IRewardManager _rewardManager,
        IPriceSubmitter _priceSubmitter,
        FtsoInflationAuthorizer _ftsoInflationAuthorizer,
        uint256 _priceEpochDurationSec,
        uint256 _firstEpochStartTs,
        uint256 _revealEpochDurationSec,
        uint256 _rewardEpochDurationSec,
        uint256 _rewardEpochsStartTs,
        uint256 _votePowerBoundaryFraction       
    ) Governed(_governance) {
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
        lastUnprocessedPriceEpochEnds  = 
            _firstEpochStartTs + ((lastUnprocessedPriceEpoch + 1) * _priceEpochDurationSec);
        currentPriceEpochEnds  = lastUnprocessedPriceEpochEnds;

        votePowerBoundaryFraction = _votePowerBoundaryFraction;
        rewardManager = _rewardManager;
        priceSubmitter = _priceSubmitter;
        ftsoInflationAuthorizer = _ftsoInflationAuthorizer;
        justStarted = true;
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
    function keep() external override returns (bool) {
        // flare keeper trigger. once every block
        
        // TODO: remove this event after testing phase
        emit KeepTrigger(block.number, block.timestamp);
        if (!active) return false;

        if (justStarted) {
            _initializeRewardEpoch();
        } else {
            if (lastUnprocessedPriceEpochEnds + revealEpochDurationSec < block.timestamp) {
                // finalizes price epoch, completely finalizes reward epoch
                _finalizePriceEpoch();
                _closeExpiredRewardEpochs();
            }
            // Note: prices should be first finalized and then new reward epoch can start
            if (currentRewardEpochEnds < block.timestamp) {
                _finalizeRewardEpoch();
            }

            if(currentPriceEpochEnds < block.timestamp) {
                // sets governance parameters on ftsos
                _initializeCurrentEpochFTSOStatesForReveal();
            }
        }
        return true;
    }

     /**
     * @notice Adds FTSO to the list of rewarded FTSOs
     * All ftsos in multi fasset ftso must be managed by this ftso manager
     */
    function addFtso(IIFtso _ftso) external override onlyGovernance {
        require(settings.initialized, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);
        
        _checkFAssetFtsosAreManaged(_ftso.getFAssetFtsos());

        uint256 len = ftsos.length;
        for (uint256 i = 0; i < len; i++) {
            if (_ftso == ftsos[i]) {
                return; // already registered
            }
        }

        _ftso.activateFtso(priceSubmitter, firstPriceEpochStartTs, priceEpochDurationSec, revealEpochDurationSec);

        // Set the vote power block
        if(!justStarted) {
            _ftso.setVotePowerBlock(rewardEpochs[currentRewardEpoch].votepowerBlock);
        }

        // Configure 
        _ftso.configureEpochs(
            settings.minVotePowerFlrThreshold,
            settings.minVotePowerAssetThreshold,
            settings.maxVotePowerFlrThreshold,
            settings.maxVotePowerAssetThreshold,
            settings.lowAssetUSDThreshold,
            settings.highAssetUSDThreshold,
            settings.highAssetTurnoutBIPSThreshold,
            settings.lowFlrTurnoutBIPSThreshold,
            settings.trustedAddresses
        );
        
        // create epoch state (later this is done at the end finalizeEpochPrice)
        _ftso.initializeCurrentEpochStateForReveal(panicMode || ftsoInPanicMode[_ftso]);

        // Add the ftso
        ftsos.push(_ftso);
        managedFtsos[_ftso] = true;

        emit FtsoAdded(_ftso, true);
    }

    /**
     * @notice Removes FTSO from the list of the rewarded FTSOs - revert if ftso is used in multi fasset ftso
     */
    function removeFtso(IIFtso _ftso) external override onlyGovernance {
        uint256 len = ftsos.length;

        for (uint256 i = 0; i < len; ++i) {
            if (_ftso == ftsos[i]) {
                ftsos[i] = ftsos[len - 1];
                ftsos.pop();
                ftsoInPanicMode[_ftso] = false;
                managedFtsos[_ftso] = false;
                _checkMultiFassetFtsosAreManaged();
                emit FtsoAdded(_ftso, false);
                return;
            }
        }

        revert(ERR_NOT_FOUND);
    }
    
    /**
     * @notice Set FAsset for FTSO
     */
    function setFtsoFAsset(IIFtso _ftso, IVPToken _fAsset) external override onlyGovernance {
        _ftso.setFAsset(_fAsset);
    }

    /**
     * @notice Set FAsset FTSOs for FTSO - all ftsos should already be managed by this ftso manager
     */
    function setFtsoFAssetFtsos(IIFtso _ftso, IIFtso[] memory _fAssetFtsos) external override onlyGovernance {
        _checkFAssetFtsosAreManaged(_fAssetFtsos);
        _ftso.setFAssetFtsos(_fAssetFtsos);
    }

    /**
     * @notice Set panic mode
     */
    function setPanicMode(bool _panicMode) external override onlyGovernance {
        panicMode = _panicMode;
        emit PanicMode(_panicMode);
    }

    /**
     * @notice Set panic mode for ftso
     */
    function setFtsoPanicMode(IIFtso _ftso, bool _panicMode) external override onlyGovernance {
        require(managedFtsos[_ftso], ERR_NOT_FOUND);
        ftsoInPanicMode[_ftso] = _panicMode;
        emit FtsoPanicMode(_ftso, _panicMode);
    }

    /**
     * @notice Sets governance parameters for FTSOs
     */
    function setGovernanceParameters(
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutBIPSThreshold,
        uint256 _lowFlrTurnoutBIPSThreshold,
        address[] memory _trustedAddresses
    ) external override onlyGovernance {
        require(_minVotePowerFlrThreshold > 0, ERR_GOV_PARAMS_INVALID);
        require(_minVotePowerAssetThreshold > 0, ERR_GOV_PARAMS_INVALID);
        require(_maxVotePowerFlrThreshold > 0, ERR_GOV_PARAMS_INVALID);
        require(_maxVotePowerAssetThreshold > 0, ERR_GOV_PARAMS_INVALID);
        require(_highAssetUSDThreshold >= _lowAssetUSDThreshold, ERR_GOV_PARAMS_INVALID);
        require(_highAssetTurnoutBIPSThreshold <= 1e4, ERR_GOV_PARAMS_INVALID);
        require(_lowFlrTurnoutBIPSThreshold <= 1e4, ERR_GOV_PARAMS_INVALID);

        settings._setState(
            _minVotePowerFlrThreshold,
            _minVotePowerAssetThreshold,
            _maxVotePowerFlrThreshold,
            _maxVotePowerAssetThreshold,
            _lowAssetUSDThreshold,
            _highAssetUSDThreshold,
            _highAssetTurnoutBIPSThreshold,
            _lowFlrTurnoutBIPSThreshold,
            _trustedAddresses
        );
    }
    
    /**
     * @notice Returns current reward epoch index (one currently running)
     */
    function getCurrentRewardEpoch() external view override returns (uint256) {
        return currentRewardEpoch;
    }

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
        return ftsos;
    }

    function getPriceEpochConfiguration() external view override returns (
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSec,
        uint256 _revealEpochDurationSec
    ) {
        return (firstPriceEpochStartTs, priceEpochDurationSec, revealEpochDurationSec);
    }

    /**
     * @notice Initializes reward epochs. Also sets vote power block to FTSOs
     */
    function _initializeRewardEpoch() internal {
        if (block.timestamp >= currentRewardEpochEnds - rewardEpochDurationSec) {
            uint256 numFtsos = ftsos.length;
            // Prime the reward epoch array with a new reward epoch
            RewardEpochData memory epochData = RewardEpochData({
                votepowerBlock: block.number - 1,
                startBlock: block.number
            });

            rewardEpochs.push(epochData);
            currentRewardEpoch = 0;

            for (uint256 i = 0; i < numFtsos; ++i) {
                ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
            }
            justStarted = false;
        }
    }

    /**
     * @notice Finalizes reward epoch
     */
    function _finalizeRewardEpoch() internal {
        if (justStarted) return;
        uint256 numFtsos = ftsos.length;

        uint256 lastRandom = block.timestamp;
        // Are there any FTSOs to process?
        if (numFtsos > 0) {
            for (uint256 i = 0; i < numFtsos; ++i) {
                lastRandom += ftsos[i].getCurrentRandom();
            }
        }

        lastRandom = uint256(keccak256(abi.encode(lastRandom)));
        // @dev when considering block boundary for vote power block:
        // - if far from now, it doesn't reflect last vote power changes
        // - if too small, possible loan attacks.     
        // IMPORTANT: currentRewardEpoch is actually the one just expired!
        uint256 votepowerBlockBoundary = 
            (block.number - rewardEpochs[currentRewardEpoch].startBlock) / 
              (votePowerBoundaryFraction == 0 ? 1 : votePowerBoundaryFraction);
        // additional notice: if someone sets votePowerBoundaryFraction to 0
        // this would cause division by 0 and effectively revert would halt the system
 
        if(votepowerBlockBoundary == 0) {
            votepowerBlockBoundary = 1;
        }
 
        uint256 votepowerBlocksAgo = lastRandom % votepowerBlockBoundary;
        // prevent block.number becoming votePowerBlock
        // if  lastRandom % votepowerBlockBoundary == 0  
        if (votepowerBlocksAgo == 0) {
            votepowerBlocksAgo = 1;
        }
        
        RewardEpochData memory epochData = RewardEpochData({
            votepowerBlock: block.number - votepowerBlocksAgo, 
            startBlock: block.number
        });
        rewardEpochs.push(epochData);

        currentRewardEpoch = rewardEpochs.length - 1;
        for (uint256 i = 0; i < numFtsos; i++) {
            ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
        }

        emit RewardEpochFinalized(epochData.votepowerBlock, epochData.startBlock);

        // Advance end-time
        currentRewardEpochEnds += rewardEpochDurationSec;
    }

    function _closeExpiredRewardEpochs() internal {
        try rewardManager.closeExpiredRewardEpochs() {
            
        } catch {
            // closing of expired failed, which is not critical
            // just emit event for diagnostics
            emit ClosingExpiredRewardEpochsFailed();
        }        
    }

    /**
     * @notice Finalizes price epoch
     * @dev TODO: This function is risky, as it does many things.
     * If any external function reverts the system could get stuck
     * We should consider try..catch for external calls to FTSOs or
     * and then maybe remediation functions
     */
    function _finalizePriceEpoch() internal {
        uint256 numFtsos = ftsos.length;

        // Are there any FTSOs to process?
        if(numFtsos > 0) {
            // choose winning ftso
            uint256 chosenFtsoId;
            if (lastUnprocessedPriceEpoch == 0 || priceEpochs[lastUnprocessedPriceEpoch-1].chosenFtso == address(0)) {
                // pump not yet primed
                chosenFtsoId = uint256(keccak256(abi.encode(
                        block.difficulty, block.timestamp
                    ))) % numFtsos;
            } else {
                // at least one finalize with real FTSO
                chosenFtsoId = uint256(keccak256(abi.encode(
                        IIFtso(priceEpochs[lastUnprocessedPriceEpoch-1].chosenFtso).getCurrentRandom()
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
                uint256 id = (chosenFtsoId + i) % numFtsos;
                try ftsos[id].finalizePriceEpoch(lastUnprocessedPriceEpoch, !wasDistributed) returns (
                    address[] memory _addresses,
                    uint256[] memory _weights,
                    uint256 _totalWeight
                ) {
                    if (!wasDistributed && _addresses.length > 0) { // change also in FTSO if condition changes
                        (addresses, weights, totalWeight) = (_addresses, _weights, _totalWeight);
                        wasDistributed = true;
                        rewardedFtsoAddress = address(ftsos[id]);
                    }
                } catch {
                    try ftsos[id].averageFinalizePriceEpoch(lastUnprocessedPriceEpoch) {
                    } catch {
                        try ftsos[id].forceFinalizePriceEpoch(lastUnprocessedPriceEpoch) {

                        } catch {
                            // this should never happen
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
                    getPriceEpochsRemainingInAnnum(lastUnprocessedPriceEpochEnds - priceEpochDurationSec),
                    currentRewardEpoch) {
                    priceEpochs[lastUnprocessedPriceEpoch].rewardDistributed = true;
                } catch {
                    // TODO: do remediation
                    // TODO: log errors in local storage
                    // TODO: issue event.
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
    function _initializeCurrentEpochFTSOStatesForReveal() internal {
        uint256 numFtsos = ftsos.length;
        for (uint256 i = 0; i < numFtsos; i++) {
            if(settings.changed) {
                ftsos[i].configureEpochs(
                    settings.minVotePowerFlrThreshold,
                    settings.minVotePowerAssetThreshold,
                    settings.maxVotePowerFlrThreshold,
                    settings.maxVotePowerAssetThreshold,
                    settings.lowAssetUSDThreshold,
                    settings.highAssetUSDThreshold,
                    settings.highAssetTurnoutBIPSThreshold,
                    settings.lowFlrTurnoutBIPSThreshold,
                    settings.trustedAddresses
                );
            }

            // TODO: take care that these functions do no revert
            try ftsos[i].initializeCurrentEpochStateForReveal(panicMode || ftsoInPanicMode[ftsos[i]]) {

            } catch {
                // TODO: do remediation
                // TODO: log errors in local storage
                // TODO: issue event.
            }
        }
        // TODO: match setting this with remediation approach
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

    function getPriceEpochsRemainingInAnnum(uint256 fromTimestamp) internal view returns(uint256) {
        uint256 endTimestamp;

        (, , , endTimestamp, ) = 
            ftsoInflationAuthorizer.inflationAnnums(ftsoInflationAuthorizer.currentAnnum());
        if (fromTimestamp <= endTimestamp && priceEpochDurationSec >= 0) {
            return (endTimestamp - fromTimestamp) / priceEpochDurationSec;
        } else {
            return 0;
        }
    }

    /**
     * @notice Check if all multi fasset ftsos are managed by this ftso manager, revert otherwise
     */
    function _checkMultiFassetFtsosAreManaged() internal view {
        uint256 len = ftsos.length;
        for (uint256 i = 0; i < len; i++) {
            _checkFAssetFtsosAreManaged(ftsos[i].getFAssetFtsos());
        }
    }

    /**
     * @notice Returns current price epoch end time.
     */
    function _getCurrentPriceEpochEndTime() internal view returns (uint256) {
        uint256 currentPriceEpoch = _getCurrentPriceEpochId();
        return firstPriceEpochStartTs + (currentPriceEpoch + 1) * priceEpochDurationSec;
    }

    /**
     * @notice Returns current price epoch id. The calculation in this function
     * should fully match to definition of current epoch id in FTSO contracts.
     */
    function _getCurrentPriceEpochId() internal view returns (uint256) {
        return (block.timestamp - firstPriceEpochStartTs) / priceEpochDurationSec;
    }
}