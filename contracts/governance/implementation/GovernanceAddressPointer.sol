// (c) 2021, Flare Networks Limited. All rights reserved.
// Please see the file LICENSE for licensing terms.

// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

///////////////////
// A special contract that will hold Flare governance address 
//      this contract enables updating governance address only by hard forking the network
//      meaning only by updating validator code.
//////////////////
contract GovernanceAddressPointer {

    address public constant SIGNAL_COINBASE = address(0x00000000000000000000000000000000000dEAD0);
    // governance address set by the validator (initialy set in cTor)
    address internal governanceAddress;

    event GovernanceAddressUpdated(
        uint256 timestamp,
        address oldGovernanceAddress,
        address newGovernanceAddress
    );

    constructor(address _governanceAddress) {
        governanceAddress = _governanceAddress;
    }

    function setGovernanceAddress(address _newGovernance) external {
        require(governanceAddress != _newGovernance, "governanceAddress == _newGovernance");
        if (msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE) {
            emit GovernanceAddressUpdated(block.timestamp, governanceAddress, _newGovernance);
            governanceAddress = _newGovernance;
        }
    }

    function getGovernanceAddress() external view returns (address) {
        return governanceAddress;
    }
