// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../implementation/AddressUpdater.sol";

import "../../ftso/interface/IIFtsoManager.sol";
import "../../ftso/interface/IIFtsoManagerV1.sol";
import "../../genesis/implementation/FlareDaemon.sol";
import "../../genesis/implementation/PriceSubmitter.sol";
import "../../tokenPools/implementation/FtsoRewardManager.sol";
import "../../token/implementation/CleanupBlockNumberManager.sol";
import "../../utils/implementation/FtsoRegistry.sol";
import "../../utils/implementation/VoterWhitelister.sol";


contract FtsoV2Upgrader is Governed {

    AddressUpdater public immutable addressUpdater;

    IIFtso[] internal ftsosToReplace;
    FlareDaemon.Registration[] internal registrations;
    
    constructor(address _governance, AddressUpdater _addressUpdater) Governed(_governance) {
        addressUpdater = _addressUpdater;
    }

    /**
     * @notice Set ftsos to be replaced in upgradeToFtsoV2 call
     */
    function setFtsosToReplace(IIFtso[] memory _ftsosToReplace) external onlyGovernance {
        ftsosToReplace = _ftsosToReplace;
    }

    /**
     * @notice Set flare daemon registrations to be registered in upgradeToFtsoV2 call
     */
    function setFlareDaemonRegistrations(FlareDaemon.Registration[] memory _registrations) external onlyGovernance {
        // UnimplementedFeatureError: Copying of type struct ... memory to storage not yet supported.
        delete registrations;
        for(uint256 i = 0; i < _registrations.length; i++) {
            registrations.push(_registrations[i]);
        }
    }

    /**
     * @notice Used to do batch upgrade of ftso manager and all connected contracts - Ftsos V2
     * - updates contracts with new ftso manager contract address,
     * - updates new ftso manager with current reward states,
     * - activates new ftso manager,
     * - replaces all ftsos,
     * - registers contracts at flare daemon,
     * - transfers governance back to multisig governance
     */
    function upgradeToFtsoV2(IIFtsoManagerV1 _oldFtsoManager) external onlyGovernance {
        require(ftsosToReplace.length > 0, "ftsos not set");
        require(registrations.length > 0, "registrations not set");

        address ftsoManagerAddress = addressUpdater.getContractAddress("FtsoManager");
        (uint256 firstRewardEpochStartTs,) = IIFtsoManager(ftsoManagerAddress).getRewardEpochConfiguration();
        require(_oldFtsoManager.rewardEpochsStartTs() == firstRewardEpochStartTs, "reward epoch start does not match");

        address priceSubmitterAddress = addressUpdater.getContractAddress("PriceSubmitter");
        address ftsoRewardManagerAddress = addressUpdater.getContractAddress("FtsoRewardManager");
        address ftsoRegistryAddress = addressUpdater.getContractAddress("FtsoRegistry");
        address voterWhitelisterAddress = addressUpdater.getContractAddress("VoterWhitelister");
        address cleanupBlockNumberManagerAddress = addressUpdater.getContractAddress("CleanupBlockNumberManager");
        address flareDaemonAddress = addressUpdater.getContractAddress("FlareDaemon");

        // update contracts with new ftso manager address
        PriceSubmitter(priceSubmitterAddress).setContractAddresses(
            IFtsoRegistryGenesis(ftsoRegistryAddress),
            voterWhitelisterAddress,
            ftsoManagerAddress);

        FtsoRewardManager(ftsoRewardManagerAddress).setContractAddresses(
            addressUpdater.getContractAddress("Inflation"),
            IIFtsoManager(ftsoManagerAddress),
            WNat(payable(addressUpdater.getContractAddress("WNat"))));

        FtsoRegistry(ftsoRegistryAddress).setFtsoManagerAddress(IIFtsoManager(ftsoManagerAddress));

        VoterWhitelister(voterWhitelisterAddress).setContractAddresses(
            IFtsoRegistry(ftsoRegistryAddress),
            ftsoManagerAddress);

        CleanupBlockNumberManager(cleanupBlockNumberManagerAddress).setTriggerContractAddress(ftsoManagerAddress);

        // set reward data to new ftso manager
        uint256 nextRewardEpochToExpire = FtsoRewardManager(ftsoRewardManagerAddress).getRewardEpochToExpireNext();
        uint256 rewardEpochsLength = _oldFtsoManager.getCurrentRewardEpoch() + 1;
        uint256 currentRewardEpochEnds = _oldFtsoManager.rewardEpochsStartTs() + 
            rewardEpochsLength * _oldFtsoManager.rewardEpochDurationSeconds();

        IIFtsoManager(ftsoManagerAddress).setInitialRewardData(
            nextRewardEpochToExpire, 
            rewardEpochsLength, 
            currentRewardEpochEnds);

        // activate ftso manager
        IIFtsoManager(ftsoManagerAddress).activate();

        // replace all ftsos and delete the list
        IIFtsoManager(ftsoManagerAddress).replaceFtsosBulk(ftsosToReplace, true, false);
        delete ftsosToReplace;

        // replace daemonized contracts and delete the list
        FlareDaemon(flareDaemonAddress).registerToDaemonize(registrations);
        delete registrations;

        // transfer governance back
        GovernedBase(ftsoManagerAddress).transferGovernance(governance);
        GovernedBase(priceSubmitterAddress).transferGovernance(governance);
        GovernedBase(ftsoRewardManagerAddress).transferGovernance(governance);
        GovernedBase(ftsoRegistryAddress).transferGovernance(governance);
        GovernedBase(voterWhitelisterAddress).transferGovernance(governance);
        GovernedBase(cleanupBlockNumberManagerAddress).transferGovernance(governance);
        GovernedBase(flareDaemonAddress).transferGovernance(governance);
    }

    /**
     * @notice Transfers governance back from upgrader contract to current governance
     */
    function transferGovernanceBack(GovernedBase[] memory _contracts) external onlyGovernance {
        for (uint256 i = 0; i < _contracts.length; i++) {
            _contracts[i].transferGovernance(governance);
        }
    }

    /**
     * @notice Returns ftsos to replace in upgradeToFtsoV2 call
     */
    function getFtsosToReplace() external view returns(IIFtso[] memory _ftsosToReplace) {
        return ftsosToReplace;
    }

    /**
     * @notice Returns flare daemon registrations to be registered in upgradeToFtsoV2 call
     */
    function getFlareDaemonRegistrations() external view returns(FlareDaemon.Registration[] memory _registrations) {
        return registrations;
    }
}
