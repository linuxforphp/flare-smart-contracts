// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IFtsoManager.sol";
import "../interfaces/IRewardManager.sol";
import "../interfaces/IFlareKeep.sol";
import "../interfaces/internal/IIFtso.sol";
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
        bool rewardDistributed;
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
    IIFtso[] internal ftsos;
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
    ) Governed(_governance) {
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
    function keep() external override returns(bool) {
        // flare keeper trigger. once every block
        
        // TODO: remove this eventafter testing phase
        emit KeepTrigger(block.number, block.timestamp);
        if (!active) return false;

        if (justStarted) {
            initializeRewardEpoch();
        } else {
            if (lastUnprocessedPriceEpochEnds + revealEpochDurationSec < block.timestamp) {
                // finalizes price epoch, completely finalizes reward epoch
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
    function addFtso(IIFtso ftso) external onlyGovernance {
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
        ftso.initializeCurrentEpochStateForReveal();
        // Add the ftso
        ftsos.push(ftso);

        emit FtsoAdded(ftso, true);
    }

    /**
     * @notice Set FAsset for FTSO
     */
    function setFtsoFAsset(IIFtso ftso, IFAsset fAsset) external onlyGovernance {
        ftso.setFAsset(fAsset);
    }

    /**
     * @notice Set FAsset FTSOs for FTSO
     */
    function setFtsoFAssetFtsos(IIFtso ftso, IIFtso[] memory fAssetFtsos) external onlyGovernance {
        ftso.setFAssetFtsos(fAssetFtsos);
    }

    /**
     * @notice Removes FTSO from the list of the rewarded FTSOs
     */
    function removeFtso(IIFtso ftso) external onlyGovernance {
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
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutBIPSThreshold,
        uint256 _lowFlrTurnoutBIPSThreshold,
        address[] memory _trustedAddresses
    ) external override onlyGovernance
    {
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
                        ftsos[id].forceFinalizePriceEpoch(lastUnprocessedPriceEpoch);
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
                    priceEpochDurationSec, currentRewardEpoch) {
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
        // CAREFUL! Notice: lastUnprocessedPriceEpoch <= ftso.getCurrentEpochId() which is equal to
        // 
        lastUnprocessedPriceEpoch++;
        lastUnprocessedPriceEpochEnds += priceEpochDurationSec;
        //TODO: Add appropriate event data
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
        return firstPriceEpochStartTs + (currentPriceEpoch + 1) * priceEpochDurationSec;
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
                firstPriceEpochStartTs + epochId * priceEpochDurationSec,
                firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSec,
                firstPriceEpochStartTs + (epochId + 1) * priceEpochDurationSec + revealEpochDurationSec,
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
    function getFtsos() external view override returns (IIFtso[] memory _ftsos) {
        return (ftsos);
    }

    function getPriceEpochConfiguration() external view override returns 
        (uint256 _firstPriceEpochStartTs, uint256 _priceEpochDurationSec, uint256 _revealEpochDurationSec) {
        return (firstPriceEpochStartTs, priceEpochDurationSec, revealEpochDurationSec);
    }
}
