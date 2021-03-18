// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


interface ICheckPointable {
    /**
     * @notice Total amount of tokens at a specific `blockNumber`.
     * @param blockNumber The block number when the totalSupply is queried
     * @return totalSupply The total amount of tokens at `blockNumber`
     **/
    function totalSupplyAt(uint blockNumber) external view returns(uint256 totalSupply);

    /**
     * @dev Queries the token balance of `owner` at a specific `blockNumber`.
     * @param owner The address from which the balance will be retrieved.
     * @param blockNumber The block number when the balance is queried.
     * @return balance The balance at `blockNumber`.
     **/
    function balanceOfAt(address owner, uint blockNumber) external view returns (uint256 balance);
}