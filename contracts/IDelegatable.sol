// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title IDelegatable interface
 * @notice Delegatable interface for tokens with voting power that can be delegated.
 **/
interface IDelegatable {
    event Delegate(address indexed from, address indexed to, uint votePower, uint blockNumber);
    event Revoke(address indexed delegator, address indexed delegatee, uint votePower, uint blockNumber);
    function delegate(address to, uint16 bips) external;
    function delegateExplicit(address to, uint amount) external;
    function revokeDelegationAt(address who, uint blockNumber) external;
    function undelegateAll() external;
    function undelegateAllExplicit(address[] memory delegateAddresses) external;
    function delegatesOf(address who) external view returns (
        address[] memory delegateAddresses,
        uint256[] memory bips,
        uint256 count, 
        uint8 delegationMode);
    function delegatesOfAt(address who, uint256 blockNumber) external view returns (
        address[] memory delegateAddresses, 
        uint256[] memory bips, 
        uint256 count, 
        uint8 delegationMode);
    // 0 = NOTSET, 1 = PERCENTAGE (simple), 2 = AMOUNT (explicit)
    function delegationModeOf(address who) external view returns(uint8);
}