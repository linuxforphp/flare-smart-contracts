// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIAddressUpdatable.sol";


abstract contract AddressUpdatable is IIAddressUpdatable {

    address public addressUpdater;

    modifier onlyAddressUpdater() {
        require (msg.sender == address(addressUpdater), "only address updater");
        _;
    }

    constructor(address _addressUpdater)  {
        require(address(_addressUpdater) != address(0), "address updater zero");
        addressUpdater = _addressUpdater;
    }
    
    /**
     * @notice external method called from AddressUpdater only
     */
    function updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        external override
        onlyAddressUpdater
    {
        // update addressUpdater address
        addressUpdater = _getContractAddress(_contractNameHashes, _contractAddresses, "AddressUpdater");
        // update all other addresses
        _updateContractAddresses(_contractNameHashes, _contractAddresses);
    }

    /**
     * @notice virtual method that a contract extending AddressUpdatable must implement
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    ) internal virtual;

    /**
     * @notice helper method to get contract address
     * @dev it reverts if contract name does not exist
     */
    function _getContractAddress(
        bytes32[] memory _nameHashes,
        address[] memory _addresses,
        string memory _nameToFind
    )
        internal pure
        returns(address)
    {
        bytes32 nameHash = keccak256(abi.encode(_nameToFind));
        address a = address(0);
        for (uint256 i = 0; i < _nameHashes.length; i++) {
            if (nameHash == _nameHashes[i]) {
                a = _addresses[i];
                break;
            }
        }
        require(a != address(0), "address zero");
        return a;
    }
}
