// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../IVPToken.sol";

contract MockVPToken is IVPToken {

    mapping(address => uint64) internal addressWeight;
    
    constructor(address[] memory addresses, uint64[] memory weights) {
        assert(addresses.length == weights.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            addressWeight[addresses[i]] = weights[i];
        }
    }

    /// @notice delegate percentage of vote power. up to x addresses. 
    /// any undelegated vote power is seen as delegated to self.
    /// howMuch units are percentage. i.e. max total delegation is 100.
    /// @dev to remove delegation set howMuch to 0
    function delegate(DelegationData[] calldata delegationData) external override {

    }

    /// @notice delegate explicit amount of voting power (in token units)
    /// @notice with delegateExplicit, must un delegate tokens before transferring out
    /// @dev un delegate by setting delegation for address to 0.
    function delegateExplicit(DelegationData[] calldata delegationData) external override {
        
    }

    /// vote power for current block
    function votePowerOf(address who) external view override returns (uint256) {
        return votePowerOfAt(who, block.number);
    }

    /// @return delegations percent - array of address delegating to me at this block
    function getDelegationsOf (address who) external view override
        returns(address[] memory delegations, uint256[] memory percent)
    {

    }

    /// @notice for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerOfAt (address who, uint256 blockNumber) public view override
        returns (uint64)
    {
        blockNumber;
        return addressWeight[who];
    }
}
