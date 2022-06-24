// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/Math.sol";
import "../../governance/implementation/Governed.sol";
import "../interface/IIAddressUpdatable.sol";


contract AddressUpdater is Governed {

    string internal constant ERR_ARRAY_LENGTHS = "array lengths do not match";
    string internal constant ERR_ADDRESS_ZERO = "address zero";

    string[] internal contractNames;
    mapping(bytes32 => address) internal contractAddresses;
    
    uint256 private timelock;
    
    mapping(uint256 => string) private updatedContractNames;
    mapping(bytes32 => address) private updatedContractAddresses;
    uint256 private updatedNamesStart;
    uint256 private updatedNamesEnd;
    uint256 private addressUpdateEffectiveAt;
    
    uint256 public updatedTimelock;
    uint256 public updatedTimelockEffectiveAt;
    
    constructor(address _governance) Governed(_governance) {
    }
    
    /**
     * @notice Sets timelock value.
     * This method is itself timelocked.
     * @param _timelock            the new timelock value
     */
    function setTimelock(uint256 _timelock) external onlyGovernance {
        _updateTimelock();  // flush the previous update if already effective (otherwise forget it)
        updatedTimelock = _timelock;
        updatedTimelockEffectiveAt = block.timestamp + timelock;
    }

    /**
     * @notice Updates contract addresses on all contracts implementing IIAddressUpdatable interface
     * @param _contractsToUpdate            contracts to be updated
     */
    function updateContractAddresses(IIAddressUpdatable[] memory _contractsToUpdate) external onlyGovernance {
        // flush the timelocked contract changes first
        if (_addressUpdatesEffective()) {
            _executeContractNamesAndAddressesChange(updatedNamesEnd - updatedNamesStart);
        }
        _updateContractAddresses(_contractsToUpdate);
    }

    /**
     * @notice Add or update contract names and addreses that are later used in updateContractAddresses calls
     * Takes effect only after timelock passes.
     * @param _contractNames                contracts names
     * @param _contractAddresses            addresses of corresponding contracts names
     */
    function addOrUpdateContractNamesAndAddresses(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    )
        external
        onlyGovernance
    {
        _addOrUpdateContractNamesAndAddresses(_contractNames, _contractAddresses);
    }
    
    /**
     * @notice Execute the timelocked address changes. Normally it is done automatically in updateContractAddresses,
     * but may have to be done manually if the batch of changes is to big to be executed in a single block. 
     * @notice Anybody can call this method because there is no visible change.
     * @param _maxCount The maximum number of changes to execute, to prevent breaking the block gas limit.
     */
    function executeContractNamesAndAddressesChange(uint256 _maxCount) external {
        require(block.timestamp >= addressUpdateEffectiveAt, "timelock still active");
        _executeContractNamesAndAddressesChange(_maxCount);
    }

    /**
     * @notice Returns the contract names and the corresponding addresses
     */
    function getContractNamesAndAddresses() external view returns(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    ) {
        _contractNames = _getContractNames();
        uint256 len = _contractNames.length;
        _contractAddresses = new address[](len);
        bool updatesEffective = _addressUpdatesEffective();
        while (len > 0) {
            len--;
            _contractAddresses[len] = _getContractAddress(_contractNames[len], updatesEffective);
        }
    }

    /**
     * @notice Returns contract address for the given name and reverts if address(0)
     */
    function getContractAddress(string memory _name) external view returns(address) {
        address a = _getContractAddress(_name, _addressUpdatesEffective());
        require(a != address(0), ERR_ADDRESS_ZERO);
        return a;
    }
    
    /**
     * @notice Returns the current effective timelock.
     */
    function getTimelock() external view returns (uint256) {
        return updatedTimelockEffectiveAt != 0 && block.timestamp >= updatedTimelockEffectiveAt 
            ? updatedTimelock : timelock;
    }

    /**
     * @notice Returns the contract names and the corresponding addresses
     */
    function getTimelockedContractUpdates() external view returns(
        string[] memory _contractNames,
        address[] memory _contractAddresses,
        uint256 _timelockExpiresAt
    ) {
        if (block.timestamp >= addressUpdateEffectiveAt) {
            return (new string[](0), new address[](0), 0);
        }
        uint256 start = updatedNamesStart;
        uint256 len = updatedNamesEnd - start;
        _contractNames = new string[](len);
        _contractAddresses = new address[](len);
        for (uint256 i = 0; i < len; i++) {
            string memory name = updatedContractNames[i + start];
            _contractNames[i] = name;
            _contractAddresses[i] = updatedContractAddresses[_keccak256AbiEncode(name)];
        }
        _timelockExpiresAt = addressUpdateEffectiveAt;
    }
    
    function contractNamesAndAddressesChangesToExecute() external view returns (uint256) {
        return block.timestamp >= addressUpdateEffectiveAt ? updatedNamesEnd - updatedNamesStart : 0;
    }
    
    /**
     * @notice Add or update contract names and addreses that are later used in updateContractAddresses calls
     * Has to wait for `timelock` time before the updates take effect.
     * @param _contractNames                contracts names
     * @param _contractAddresses            addresses of corresponding contracts names
     */
    function _addOrUpdateContractNamesAndAddresses(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    )
        internal
    {
        uint256 len = _contractNames.length;
        require(len == _contractAddresses.length, ERR_ARRAY_LENGTHS);

        for (uint256 i = 0; i < len; i++) {
            require(_contractAddresses[i] != address(0), ERR_ADDRESS_ZERO);
            bytes32 nameHash = _keccak256AbiEncode(_contractNames[i]);
            // add new contract name if address is not known yet
            if (updatedContractAddresses[nameHash] == address(0)) {
                updatedContractNames[updatedNamesEnd++] = _contractNames[i];
            }
            // set or update contract address
            updatedContractAddresses[nameHash] = _contractAddresses[i];
        }
        
        // update the timelock expiration after every change
        _updateTimelock();
        addressUpdateEffectiveAt = block.timestamp + timelock;
    }
    
    /**
     * @notice Execute the timelocked address changes. Normally it is done automatically in updateContractAddresses,
     * but may have to be done manually if the batch of changes is to big to be executed in a single block. 
     * @param _maxCount The maximum number of changes to execute, to prevent breaking the block gas limit.
     */
    function _executeContractNamesAndAddressesChange(uint256 _maxCount) internal {
        uint256 end = Math.min(updatedNamesEnd, updatedNamesStart + _maxCount);
        for (uint256 i = updatedNamesStart; i < end; i++) {
            string memory name = updatedContractNames[i];
            bytes32 nameHash = _keccak256AbiEncode(name);
            delete updatedContractNames[i];
            // add new contract name if address is not known yet
            if (contractAddresses[nameHash] == address(0)) {
                contractNames.push(name);
            }
            // set or update contract address
            contractAddresses[nameHash] = updatedContractAddresses[nameHash];
            updatedContractAddresses[nameHash] = address(0);
        }
        updatedNamesStart = end;
    }
    
    /**
     * @notice Updates contract addresses on all contracts implementing IIAddressUpdatable interface
     * @param _contractsToUpdate            contracts to be updated
     */
    function _updateContractAddresses(IIAddressUpdatable[] memory _contractsToUpdate) internal {
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
     * @notice Returns hash from string value
     */
    function _keccak256AbiEncode(string memory _value) internal pure returns(bytes32) {
        return keccak256(abi.encode(_value));
    }

    /**
     * @notice If timelock was changed and the waiting period has expired, update.
     */
    function _updateTimelock() private {
        if (updatedTimelockEffectiveAt != 0 && block.timestamp >= updatedTimelockEffectiveAt) {
            timelock = updatedTimelock;
            updatedTimelockEffectiveAt = 0;
        }
    }
    
    /**
     * @notice Get contract names, possibly mixed with waiting ones if the timnelock has expired.
     */
    function _getContractNames() private view returns (string[] memory _contractNames) {
        if (_addressUpdatesEffective()) {
            uint256 newCount = 0;
            uint256 length = contractNames.length;
            uint256 updatedEnd = updatedNamesEnd;
            for (uint256 i = updatedNamesStart; i < updatedEnd; i++) {
                if (contractAddresses[_keccak256AbiEncode(updatedContractNames[i])] == address(0)) {
                    ++newCount;
                }
            }
            _contractNames = new string[](length + newCount);
            for (uint256 i = 0; i < length; i++) {
                 _contractNames[i] = contractNames[i];
            }
            uint256 dest = length;
            for (uint256 i = updatedNamesStart; i < updatedEnd; i++) {
                if (contractAddresses[_keccak256AbiEncode(updatedContractNames[i])] == address(0)) {
                    _contractNames[dest] = updatedContractNames[i];
                    dest++;
                }
            }
        } else {
            _contractNames = contractNames;
        }
    }
    
    /**
     * @notice Get contract address, possibly from waiting ones if the timnelock has expired.
     */
    function _getContractAddress(string memory _name, bool _checkUpdates) private view returns(address) {
        bytes32 key = _keccak256AbiEncode(_name);
        address result = address(0);
        if (_checkUpdates) {
            result = updatedContractAddresses[key];  // return waiting address if timelock expired and not yet flushed
        }
        if (result == address(0)) {
            result = contractAddresses[key];
        }
        return result;
    }
    
    /**
     * Returns true if there are contract address updates and the update timelock has expired.
     */
    function _addressUpdatesEffective() private view returns (bool) {
        return updatedNamesEnd > updatedNamesStart && block.timestamp >= addressUpdateEffectiveAt;
    }
}
