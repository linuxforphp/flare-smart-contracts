// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title IVotePower interface
 * @notice Vote power interface for tokens that expose voting power.
 **/
interface IVotePower {
    function undelegatedVotePowerOf(address owner) external view returns(uint256);
    function undelegatedVotePowerOfAt(address owner, uint256 blockNumber) external view returns(uint256);
    function votePower() external view returns(uint256);
    function votePowerAt(uint blockNumber) external view returns(uint256);
    function votePowerFromTo(address from, address to) external view returns(uint256);
    function votePowerFromToAt(address from, address to, uint blockNumber) external view returns(uint256);
    function votePowerOf(address owner) external view returns(uint256);
    function votePowerOfAt(address owner, uint256 _blockNumber) external view returns(uint256);
}