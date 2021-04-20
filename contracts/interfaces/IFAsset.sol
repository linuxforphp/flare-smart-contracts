// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IVotePower.sol";

/**
 * @title IFtsoFAsset interface
 * @notice FTSO FAsset interface for ERC20 tokens that expose voting power.
 **/
interface IFAsset is IVotePower {

    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function decimals() external view returns (uint8);

}