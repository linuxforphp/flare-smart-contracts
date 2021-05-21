// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVotePowerCached {
    /**
    * @notice Get the vote power at block `blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if blockNumber is in the past, otherwise reverts.    
    * @param blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAtCached(uint blockNumber) external returns(uint256);
    
    /**
    * @notice Get the vote power of `owner` at block `blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if blockNumber is in the past, otherwise reverts.    
    * @param owner The address to get voting power.
    * @param blockNumber The block number at which to fetch.
    * @return Vote power of `owner` at `blockNumber`.
    */
    function votePowerOfAtCached(address owner, uint256 blockNumber) external returns(uint256);
}