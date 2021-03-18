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
    function delegateExplicit(address to, uint) external;
    function revokeDelegationAt(address who, uint blockNumber) external;
    function undelegateAll() external;
    function delegatesOf(address who) external view returns (
        address[] memory, 
        uint256[] memory, 
        uint256 count, 
        uint8 delegationMode);
    function delegationModeOf(address who) external view returns(uint8);
    function undelegatedVotePowerOf(address owner) external view returns(uint256);
    function votePower() external view returns(uint256);
    function votePowerAt(uint blockNumber) external view returns(uint256);
    function votePowerFromTo(address from, address to) external view returns(uint256);
    function votePowerFromToAt(address from, address to, uint blockNumber) external view returns(uint256);
    function votePowerOf(address owner) external view returns(uint256);
    function votePowerOfAt(address owner, uint256 _blockNumber) external view returns(uint256);
}