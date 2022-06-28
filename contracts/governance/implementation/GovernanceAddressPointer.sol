// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


///////////////////
// A special contract that will hold Flare governance address 
//      this contract enables updating governance address only by hard forking the network
//      meaning only by updating validator code.
//////////////////
contract GovernanceAddressPointer {

    address public constant SIGNAL_COINBASE = address(0x000000000000000000000000000000000000dEaD);
    // governance address set by the validator
    internal address governanceAddress;

    function setGovernanceAddress external (address _newGovernance) {
        require((msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE),
                 "wrong msg.sender");

        governanceAddress = _newGovernance;
    }

    function getGovernanceAddress external view () returns (address) {
        return governanceAddress;
    }
}
