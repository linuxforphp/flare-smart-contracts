// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./utils/IERC20.sol";


interface IDelegationToken {

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

    /// @notice. for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerFromToAtBlock(address me, address him, uint256 blockNumber) 
        external view returns (uint256 votePower);

    function votePowerOfAt (address who, uint256 blockNumber) external view 
        returns (uint256 votePower);

    /// @returns array of address delegating to me at this block
    function getDelegationsOf (address who) external view
        returns(address[] delegations, uint256[] percent);
}
