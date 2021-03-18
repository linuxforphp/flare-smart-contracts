// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

interface IVPToken {

    struct DelegationData {
        uint value;
    }

    /// @notice An event thats emitted when an account changes its delegation data
    event DelegationUpdate(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);

    /// @notice An event thats emitted when a delegate account's vote balance changes
    event VotePowerUpdated(address indexed delegate, uint previousVotePower, uint newVotePower);

    /// @notice delegate percentage of vote power. up to x addresses. 
    /// any undelegated vote power is seen as delegated to self.
    /// howMuch units are percentage. i.e. max total delegation is 100.
    /// @dev to remove delegation set howMuch to 0
    function delegate(DelegationData[] calldata delegationData) external;

    /// @notice delegate explicit amount of voting power (in token units)
    /// @notice with delegateExplicit, must un delegate tokens before transferring out
    /// @dev un delegate by setting delegation for address to 0.
    function delegateExplicit(DelegationData[] calldata delegationData) external;

    /// vote power for current block
    function votePowerOf(address who) external view returns (uint256 _votePower);

    /// @notice for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.

    function votePowerOfAt (address who, uint256 blockNumber) external view 
        returns (uint64 _votePower);

    /// @return delegations percent - array of address delegating to me at this block
    function getDelegationsOf (address who) external view
        returns(address[] memory delegations, uint256[] memory percent);
}
