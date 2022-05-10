// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../token/interface/IIGovernanceVotePower.sol";

abstract contract GovernorVotePower {

    IIGovernanceVotePower internal votePower;
    
    constructor(address _votePowerAddress) {
        votePower = IIGovernanceVotePower(_votePowerAddress);
        votePower.getCleanupBlockNumber();
    }

    function totalVotePowerAt(uint256 _blockNumber) internal view returns (uint256) {
        return votePower.ownerToken().totalVotePowerAt(_blockNumber);
    }

    function votePowerOfAt(address _owner, uint256 _blockNumber) internal view returns (uint256) {
        return votePower.votePowerOfAt(_owner, _blockNumber);
    }

}
