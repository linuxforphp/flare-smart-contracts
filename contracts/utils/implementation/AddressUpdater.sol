// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/Governed.sol";
import "../interface/IIAddressUpdatable.sol";

import "../../ftso/interface/IIFtsoManager.sol";
import "../../ftso/interface/IIFtsoManagerV1.sol";
import "../../genesis/implementation/FlareDaemon.sol";
import "../../genesis/implementation/PriceSubmitter.sol";
import "../../tokenPools/implementation/FtsoRewardManager.sol";
import "../../token/implementation/CleanupBlockNumberManager.sol";
import "../../utils/implementation/FtsoRegistry.sol";
import "../../utils/implementation/VoterWhitelister.sol";


contract AddressUpdater is Governed {

    string internal constant ERR_ARRAY_LENGTHS = "array lengths do not match";
    string internal constant ERR_ADDRESS_ZERO = "address zero";

    string[] internal contractNames;
    mapping(bytes32 => address) internal contractAddresses;


    IIFtso[] internal ftsosToReplace;
    FlareDaemon.Registration[] internal registrations;
    
    constructor(address _governance) Governed(_governance) {}

    /**
     * @notice Set ftsos to be replaced in switchToNewFtsoManager call
     */
    function setFtsosToReplace(IIFtso[] memory _ftsosToReplace) external onlyGovernance {
        ftsosToReplace = _ftsosToReplace;
    }

    /**
     * @notice Set flare daemon registrations to be registered in switchToNewFtsoManager call
     */
    function setFlareDaemonRegistrations(FlareDaemon.Registration[] memory _registrations) external onlyGovernance {
        // UnimplementedFeatureError: Copying of type struct ... memory to storage not yet supported.
        delete registrations;
        for(uint256 i = 0; i < _registrations.length; i++) {
            registrations.push(_registrations[i]);
        }
    }

    /**
     * @notice Used to do batch update of ftso manager and all connected contracts
     * - updates contracts with new ftso manager contract address,
     * - updates new ftso manager with current reward states,
     * - activates new ftso manager,
     * - replaces all ftsos,
     * - registers contracts at flare daemon,
     * - transfers governance back to multisig governance
     */
    function switchToNewFtsoManager(IIFtsoManagerV1 _oldFtsoManager) external onlyGovernance {
        require(ftsosToReplace.length > 0, "ftsos not set");
        require(registrations.length > 0, "registrations not set");

        address ftsoManagerAddress = _getContractAddress("FtsoManager");
        (uint256 firstRewardEpochStartTs,) = IIFtsoManager(ftsoManagerAddress).getRewardEpochConfiguration();
        require(_oldFtsoManager.rewardEpochsStartTs() == firstRewardEpochStartTs, "reward epoch start does not match");

        address priceSubmitterAddress = _getContractAddress("PriceSubmitter");
        address ftsoRewardManagerAddress = _getContractAddress("FtsoRewardManager");
        address ftsoRegistryAddress = _getContractAddress("FtsoRegistry");
        address voterWhitelisterAddress = _getContractAddress("VoterWhitelister");
        address cleanupBlockNumberManagerAddress = _getContractAddress("CleanupBlockNumberManager");
        address flareDaemonAddress = _getContractAddress("FlareDaemon");

        // update contracts with new ftso manager address
        PriceSubmitter(priceSubmitterAddress).setContractAddresses(
            IFtsoRegistryGenesis(ftsoRegistryAddress),
            voterWhitelisterAddress,
            ftsoManagerAddress);

        FtsoRewardManager(ftsoRewardManagerAddress).setContractAddresses(
            _getContractAddress("Inflation"),
            IIFtsoManager(ftsoManagerAddress),
            WNat(payable(_getContractAddress("WNat"))));

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
     * @notice Updates contract addresses on all contracts implementing IIAddressUpdatable interface
     * @param _contractsToUpdate            contracts to be updated
     */
    function updateContractAddresses(IIAddressUpdatable[] memory _contractsToUpdate) external onlyGovernance {
        uint256 len = contractNames.length;
        bytes32[] memory nameHashes = new bytes32[](len);
        address[] memory addresses = new address[](len);
        while (len > 0) {
            len--;
            nameHashes[len] = _keccak256AbiEncode(contractNames[len]);
            addresses[len] = contractAddresses[nameHashes[len]];
        }

        for (uint256 i = 0; i < _contractsToUpdate.length; i++) {
            _contractsToUpdate[i].updateContractAddresses(nameHashes, addresses);
        }
    }

    /**
     * @notice Add or update contract names and addreses that are later used in updateContractAddresses calls
     */
    function addOrUpdateContractNamesAndAddresses(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    )
        external
        onlyGovernance
    {
        uint256 len = _contractNames.length;
        require(len == _contractAddresses.length, ERR_ARRAY_LENGTHS);

        for (uint256 i = 0; i < len; i++) {
            require(_contractAddresses[i] != address(0), ERR_ADDRESS_ZERO);
            bytes32 nameHash = _keccak256AbiEncode(_contractNames[i]);
            // add new contract name if address is not known yet
            if (contractAddresses[nameHash] == address(0)) {
                contractNames.push(_contractNames[i]);
            }
            // set or update contract address
            contractAddresses[nameHash] = _contractAddresses[i];
        }
    }

    /**
     * @notice Transfers governance back from address updater contract to current governance
     */
    function transferGovernanceBack(GovernedBase[] memory _contracts) external onlyGovernance {
        for (uint256 i = 0; i < _contracts.length; i++) {
            _contracts[i].transferGovernance(governance);
        }
    }

    /**
     * @notice Returns the contract names and the corresponding addresses
     */
    function getContractNamesAndAddresses() external view returns(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    ) {
        _contractNames = contractNames;
        uint256 len = _contractNames.length;
        _contractAddresses = new address[](len);
        while (len > 0) {
            len--;
            _contractAddresses[len] = contractAddresses[_keccak256AbiEncode(_contractNames[len])];
        }
    }

    /**
     * @notice Returns ftsos to replace in switchToNewFtsoManager call
     */
    function getFtsosToReplace() external view returns(IIFtso[] memory _ftsosToReplace) {
        return ftsosToReplace;
    }

    /**
     * @notice Returns flare daemon registrations to be registered in switchToNewFtsoManager call
     */
    function getFlareDaemonRegistrations() external view returns(FlareDaemon.Registration[] memory _registrations) {
        return registrations;
    }

        /**
     * @notice Returns contract address for the given name and reverts if address(0)
     */
    function getContractAddress(string memory _name) external view returns(address) {
        return _getContractAddress(_name);
    }

    /**
     * @notice Returns contract address for the given name and reverts if address(0)
     */
    function _getContractAddress(string memory _name) internal view returns(address) {
        address a = contractAddresses[_keccak256AbiEncode(_name)];
        require(a != address(0), ERR_ADDRESS_ZERO);
        return a;
    }

    /**
     * @notice Returns hash from string value
     */
    function _keccak256AbiEncode(string memory _value) internal pure returns(bytes32) {
        return keccak256(abi.encode(_value));
    }
}
