// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IVotePower.sol";

contract MockVPToken is IVotePower {

    mapping(address => uint64) internal addressWeight;
    
    constructor(address[] memory addresses, uint64[] memory weights) {
        assert(addresses.length == weights.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            addressWeight[addresses[i]] = weights[i];
        }
    }

    function votePower() public view override returns(uint256) {}
    function votePowerAt(uint blockNumber) public view override returns(uint256) {}
    function votePowerFromTo(address from, address to) public view override returns(uint256) {}
    function votePowerFromToAt(address from, address to, uint blockNumber) public view override returns(uint256) {}

    /// vote power for current block
    function votePowerOf(address who) public view override returns (uint256) {
        return votePowerOfAt(who, block.number);
    }

    /// @notice for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerOfAt (address who, uint256 blockNumber) public view override
        returns (uint256)
    {
        blockNumber;
        return addressWeight[who];
    }

    function undelegatedVotePowerOf(address owner) public view override returns(uint256) {}
}
