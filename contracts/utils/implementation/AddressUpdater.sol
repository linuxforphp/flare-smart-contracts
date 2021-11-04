// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/Governed.sol";
import "../interface/IIAddressUpdatable.sol";


contract AddressUpdater is Governed {

    string internal constant ERR_ARRAY_LENGTHS = "array lengths do not match";
    string internal constant ERR_ADDRESS_ZERO = "address zero";

    string[] internal contractNames;
    mapping(bytes32 => address) internal contractAddresses;

    constructor(address _governance) Governed(_governance) {}
    
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
     * @notice Returns contract address for the given name and reverts if address(0)
     */
    function getContractAddress(string memory _name) external view returns(address) {
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
