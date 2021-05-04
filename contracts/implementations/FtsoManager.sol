// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IFtsoManager.sol";
import "../interfaces/IRewardManager.sol";
import "../interfaces/IFlareKeep.sol";
import "../IFtso.sol";
import "./Governed.sol";

import "../lib/FtsoManagerSettings.sol";
// import "hardhat/console.sol";
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
contract FtsoManager is IFtsoManager, IFlareKeep, Governed {
    using FtsoManagerSettings for FtsoManagerSettings.State;

    struct PriceEpochData {
        address chosenFtso;
        uint256 rewardEpochId;
    }

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
    }

    string internal constant ERR_REWARD_EPOCH_DURATION_ZERO = "Reward epoch 0";
    string internal constant ERR_PRICE_EPOCH_DURATION_ZERO = "Price epoch 0";
    string internal constant ERR_FIRST_EPOCH_STARTS_TS_ZERO = "First epoch start 0";
    string internal constant ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "gov. params not initialized";
    string internal constant ERR_NOT_FOUND = "not found";
    bool internal active;

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

    // TODO: consider enabling duration updates
    // reward Epoch data
    uint256 internal currentRewardEpoch;
    uint256 immutable public rewardEpochDurationSec;
    uint256 immutable public rewardEpochsStartTs;
    uint256 internal currentRewardEpochEnds;
    uint256 internal votePowerBoundaryFraction;

    // list of ftsos eligible for reward
    IFtso[] internal ftsos;
    IRewardManager internal rewardManager;

    // flags
    bool private justStarted;

    constructor(
        address _governance,
        IRewardManager _rewardManager,
        uint256 _priceEpochDurationSec,
        uint256 _firstEpochStartTs,
        uint256 _revealEpochDurationSec,
        uint256 _rewardEpochDurationSec,
        uint256 _rewardEpochsStartTs,
        uint256 _votePowerBoundaryFraction       
    ) Governed(_governance) 
    {
        require(_rewardEpochDurationSec > 0, ERR_REWARD_EPOCH_DURATION_ZERO);
        require(_priceEpochDurationSec > 0, ERR_PRICE_EPOCH_DURATION_ZERO);
        // TODO: probably whe should allow this
        require(_firstEpochStartTs > 0, ERR_FIRST_EPOCH_STARTS_TS_ZERO);

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
        justStarted = true;
    }

    /**
     * @notice Activates FTSO manager (keep() runs jobs)
     */
    function activate() external onlyGovernance {
        active = true;
    }

    /**
     * @notice Deactivates FTSO manager (keep() stops running jobs)
     */
    function deactivate() external onlyGovernance {
        active = false;
    }

    /**
     * @notice Runs task triggered by Keeper.
     * The tasks include the following by priority
     * - finalizePriceEpoch     
     * - Set governance parameters and initialize epochs
     * - finalizeRewardEpoch 
     */
    function keep() external override returns(bool){
        // flare keeper trigger. once every block
        
        // TODO: remove this eventafter testing phase
        emit KeepTrigger(block.number);
        if (!active) return false;
            
        if (justStarted) {
            initializeRewardEpoch();
        } else {
            if (lastUnprocessedPriceEpochEnds + revealEpochDurationSec < block.timestamp) {
                // finalizes price epoch, completely finalizes reward epoch,                         
                finalizePriceEpoch();
            }
            // Note: prices should be first finalized and then new reward epoch can start
            if (currentRewardEpochEnds < block.timestamp) {
                finalizeRewardEpoch();
            }

            if(currentPriceEpochEnds < block.timestamp) {                 
                // sets governance parameters on ftsos
                initializeCurrentEpochFTSOStatesForReveal();
            }
        }
        return true;
    }

    /**
     * @notice Initializes reward epochs. Also sets vote power block to FTSOs
     */
    function initializeRewardEpoch() internal {
        if (block.timestamp >= currentRewardEpochEnds - rewardEpochDurationSec) {
            uint numFtsos = ftsos.length;
            // Prime the reward epoch array with a new reward epoch
            // TODO: Randomize? What if there are no FTSOs here? Can't use same algo.
            RewardEpochData memory epochData = RewardEpochData({
                votepowerBlock: block.number - 1, 
                startBlock: block.number
            });

            rewardEpochs.push(epochData);
            currentRewardEpoch = 0; 

            for (uint i; i < numFtsos; ++i) {
                ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
            }
            justStarted = false;
        }
    }

    /**
     * @notice Finalizes reward epoch
     */
    function finalizeRewardEpoch() internal {
        if (justStarted) return;
        uint numFtsos = ftsos.length;

        uint256 lastRandom = block.timestamp;
        // Are there any FTSOs to process?
        if (numFtsos > 0) {            
            for (uint i = 0; i < numFtsos; ++i) {
                lastRandom += ftsos[i].getCurrentRandom();
            }
        }   

        lastRandom = uint256(keccak256(abi.encode(lastRandom)));
        // @dev when considering block boundary for vote power block:
        // - if far from now, it doesn't reflect last vote power changes
        // - if too small, possible loan attacks.     
        // IMPORTANT: currentRewardEpoch is actually the one just expired!
        // NOTE: even block.number can become votePowerBlock in this setting 
        // if  lastRandom % votepowerBlockBoundary == 0  
        uint256 votepowerBlockBoundary = 
            (block.number - rewardEpochs[currentRewardEpoch].startBlock) / 
              (votePowerBoundaryFraction == 0 ? 1 : votePowerBoundaryFraction);  
        // additional notice: if someone sets votePowerBoundaryFraction to 0
        // this would cause division by 0 and effectively revert would halt the
        // system
 
        if(votepowerBlockBoundary == 0) {
            votepowerBlockBoundary = 1;
        }
        RewardEpochData memory epochData = RewardEpochData({
            votepowerBlock: block.number - (lastRandom % votepowerBlockBoundary), 
            startBlock: block.number
        });
        rewardEpochs.push(epochData);

        currentRewardEpoch = rewardEpochs.length - 1;
        for (uint i; i < numFtsos; ++i) {
            ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
        }

        emit RewardEpochFinalized(epochData.votepowerBlock, epochData.startBlock);
        

        // Advance end-time even if no epochData is added to array.
        // TODO: Consider adding RewardEpochData even if no ftsos to prevent gaps
        currentRewardEpochEnds += rewardEpochDurationSec;
    }

    /**
     * @notice Adds FTSO to the list of rewarded FTSOs
     */
    function addFtso(IFtso ftso) external onlyGovernance {
        require(settings.initialized, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);
        uint256 len = ftsos.length;

        for (uint256 i = 0; i < len; i++) {
            if (address(ftso) == address(ftsos[i])) {
                return; // already registered
            }
        }

        ftso.initializeEpochs(firstPriceEpochStartTs, priceEpochDurationSec, revealEpochDurationSec);

        // Set the vote power block
        // TODO: what is the condition?
        // if (priceEpochs.length > 0) {
        if(!justStarted) {    
            ftso.setVotePowerBlock(rewardEpochs[currentRewardEpoch].votepowerBlock);
        }
        // }

        // Configure 
        ftso.configureEpochs(
            settings.minVoteCount,
            settings.minVotePowerFlrThreshold,
            settings.minVotePowerAssetThreshold,
            settings.maxVotePowerFlrThreshold,
            settings.maxVotePowerAssetThreshold,
            settings.lowAssetUSDThreshold,
            settings.highAssetUSDThreshold,
            settings.highAssetTurnoutThreshold
        );
        
        // create epoch state (later this is done at the end finalizeEpochPrice)
        ftso.initializeCurrentEpochStateForReveal();
        // Add the ftso
        ftsos.push(ftso);

        emit FtsoAdded(ftso, true);
    }

    /**
     * @notice Set FAsset for FTSO
     */
    function setFtsoFAsset(IFtso ftso, IFAsset fAsset) external onlyGovernance {
        ftso.setFAsset(fAsset);
    }

    /**
     * @notice Set FAsset FTSOs for FTSO
     */
    function setFtsoFAssetFtsos(IFtso ftso, IFtso[] memory fAssetFtsos) external onlyGovernance {
        ftso.setFAssetFtsos(fAssetFtsos);
    }

    /**
     * @notice Removes FTSO from the list of the rewarded FTSOs
     */
    function removeFtso(IFtso ftso) external onlyGovernance {
        // TODO: Handle case where you want to remove a FTSO that is in a fAssetFtsos of FLR FTSO (multiasset)?
        uint256 len = ftsos.length;

        for (uint256 i = 0; i < len; ++i) {
            if (address(ftso) == address(ftsos[i])) {
                ftsos[i] = ftsos[len - 1];
                ftsos.pop();
                emit FtsoAdded (ftso, false);
                return;
            }
        }

        revert(ERR_NOT_FOUND);
    }

    /**
     * @notice Sets governance parameters for FTSOs
     */
    function setGovernanceParameters(
        uint256 _minVoteCount,
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThreshold
    ) external override onlyGovernance 
    {
        settings._setState(
            _minVoteCount, 
            _minVotePowerFlrThreshold, 
            _minVotePowerAssetThreshold, 
            _maxVotePowerFlrThreshold, 
            _maxVotePowerAssetThreshold, 
            _lowAssetUSDThreshold, 
            _highAssetUSDThreshold, 
            _highAssetTurnoutThreshold
        );
    } 

    /**
     * @notice Finalizes price epoch
     * @dev TODO: This function is risky, as does it does many things.
     * If any external function reverts the system could get stuck
     * We should consider try..catch for external calls to FTSOs or
     * and then maybe remediation functions
     */
    function finalizePriceEpoch() internal {
        uint numFtsos = ftsos.length;

        // Are there any FTSOs to process?
        if(numFtsos > 0) {
            // choose winning ftso
            uint256 rewardedFtsoId;
            if (lastUnprocessedPriceEpoch == 0 || priceEpochs[lastUnprocessedPriceEpoch-1].chosenFtso == address(0)) {
                // Pump not yet primed; start with first ftso?
                rewardedFtsoId = 
                    uint256(keccak256(abi.encode(
                        ftsos[0].getCurrentRandom()
                    ))) % numFtsos;
            } else { 
                // at least one finalize with real FTSO
                rewardedFtsoId = 
                    uint256(keccak256(abi.encode(
                        IFtso(priceEpochs[lastUnprocessedPriceEpoch-1].chosenFtso).getCurrentRandom()
                    ))) % numFtsos;
            }

            bool wasDistributed = determineRewards(ftsos[rewardedFtsoId]);

            // On the off chance that the winning FTSO does not have any
            // recipient within the truncated price distribution to
            // receive rewards, find the next FTSO that does have reward
            // recipients and declare it the winner.
            for (uint i = 0; i < numFtsos; i++) {
                if (i == rewardedFtsoId) continue;

                if (wasDistributed) {               
                    try ftsos[i].finalizePriceEpoch(lastUnprocessedPriceEpoch, false) {

                    } catch {
                        ftsos[i].forceFinalizePriceEpoch(lastUnprocessedPriceEpoch);
                    }
                } else {
                    // TODO: maybe we should optimize so that award is given
                    // a kind of a randomly chosen remaining FTSO.
                    // The following loop traverses all indices but priviledges the next in cycle
                    // for(uint i = (rewardedFtsoId + 1) % numFtsos; 
                    //     i != rewardedFtsoId; i = (i + 1) % numFtsos)                   
                    wasDistributed = determineRewards(ftsos[i]);
                    rewardedFtsoId = i;
                }
            }
      
            priceEpochs[lastUnprocessedPriceEpoch] = PriceEpochData({
                chosenFtso: address(ftsos[rewardedFtsoId]),
                rewardEpochId: currentRewardEpoch
            });     
            emit PriceEpochFinalized(address(ftsos[rewardedFtsoId]), currentRewardEpoch);       
        } else {
            priceEpochs[lastUnprocessedPriceEpoch] = PriceEpochData({
                chosenFtso: address(0),
                rewardEpochId: currentRewardEpoch
            });    
            emit PriceEpochFinalized(address(0), currentRewardEpoch);               
        }      
        // Advance to next price epoch
        // CAREFUL! Notice: lastUnprocessedPriceEpoch <= ftso.getCurrentEpochId() which is equal to
        // 
        lastUnprocessedPriceEpoch++;
        lastUnprocessedPriceEpochEnds += priceEpochDurationSec;        
        //TODO: Add appropriate event data        
    }

    /**
     * @notice Determines rewards for a chosen FTSO and notifies RewardManager.
     */
    function determineRewards(IFtso ftso) internal returns (bool wasDistirubted) {

        address[] memory addresses;
        uint256[] memory weights;
        uint256 totalWeight; 

        try ftso.finalizePriceEpoch(lastUnprocessedPriceEpoch, true) returns (
            address[] memory _addresses,
            uint256[] memory _weights,
            uint256 _totalWeight
        ) {
            (addresses, weights, totalWeight) = (_addresses, _weights, _totalWeight);
        } catch {
            // If 
            ftso.forceFinalizePriceEpoch(lastUnprocessedPriceEpoch);
            return false;
        }

        if (addresses.length == 0) return false;        
        // TODO: we should assure that in case we are here, totalWeight > 0. Please verify.
        rewardManager.distributeRewards(
            addresses, weights, totalWeight, 
            lastUnprocessedPriceEpoch, address(ftso), 
            priceEpochDurationSec, currentRewardEpoch
        ); 
         
        return true; 
    }

    /**
     * @notice Returns current reward eoch index (one currently running)
     */
    function getCurrentRewardEpoch() external view override returns (uint256) {
        return currentRewardEpoch;
    }

    /**
     * @notice Returns current price epoch end time.
     */
    function getCurrentPriceEpochEndTime() internal view returns (uint256) {
        uint256 currentPriceEpoch = getCurrentPriceEpochId();
        return firstPriceEpochStartTs + (currentPriceEpoch + 1)*priceEpochDurationSec;
    }

    /**
     * @notice Returns current price epoch id. The calculation in this function
     * should fully match to definition of current epoch id in FTSO contracts.
     */
    function getCurrentPriceEpochId() internal view returns (uint256) {
        return (block.timestamp - firstPriceEpochStartTs) / priceEpochDurationSec;
    }

    function getCurrentPriceEpochData() external view override returns 
        (
            uint256 priceEpochId, 
            uint256 priceEpochStartTimestamp, 
            uint256 priceEpochEndTimestamp, 
            uint256 priceEpochRevealEndTimestamp, 
            uint256 currentTimestamp
        ) {
            uint epochId = getCurrentPriceEpochId();
            return (
                epochId, 
                epochId == 0 ? firstPriceEpochStartTs : firstPriceEpochStartTs + (epochId - 1)*priceEpochDurationSec,
                firstPriceEpochStartTs + epochId * priceEpochDurationSec,
                firstPriceEpochStartTs + epochId * priceEpochDurationSec + revealEpochDurationSec,
                block.timestamp
            );
    }

    /**
     * @notice Initializes epoch states in FTSOs for reveal. 
     * Prior to initialization it sets governance parameters, if 
     * governance has changed them.
     */
    function initializeCurrentEpochFTSOStatesForReveal() internal {
        uint numFtsos = ftsos.length;
        for (uint i = 0; i < numFtsos; i++) {
            if(settings.changed) {
                ftsos[i].configureEpochs(
                    settings.minVoteCount,
                    settings.minVotePowerFlrThreshold,
                    settings.minVotePowerAssetThreshold,
                    settings.maxVotePowerFlrThreshold,
                    settings.maxVotePowerAssetThreshold,
                    settings.lowAssetUSDThreshold,
                    settings.highAssetUSDThreshold,
                    settings.highAssetTurnoutThreshold
                );
            }
               
            // TODO: take care that these functions do no revert
            try ftsos[i].initializeCurrentEpochStateForReveal() {

            } catch {
                // TODO: do remediation
                // TODO: log errors in local storage
                // TODO: issue event.
            }
        }
        // TODO: match setting this with remediation approach
        settings.changed = false;
   
        currentPriceEpochEnds = getCurrentPriceEpochEndTime();    
    }

    /**
     * @notice Returns the list of rewarded FTSOs
     */
    function getFtsos() external view override returns (IFtso[] memory _ftsos) {
        return (ftsos);
    }

    function getPriceEpochConfiguration() external view override returns 
        (uint256 _firstPriceEpochStartTs, uint256 _priceEpochDurationSec, uint256 _revealEpochDurationSec) {
        return (firstPriceEpochStartTs, priceEpochDurationSec, revealEpochDurationSec);
    }

}
