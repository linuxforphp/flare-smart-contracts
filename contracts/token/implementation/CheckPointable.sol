// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {CheckPointHistory} from "../lib/CheckPointHistory.sol";
import {CheckPointsByAddress} from "../lib/CheckPointsByAddress.sol";
import {CheckPointHistoryCache} from "../lib/CheckPointHistoryCache.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
 
/**
 * @title Check Pointable ERC20 Behavior
 * @notice ERC20 behavior which adds balance check point features.
 **/
abstract contract CheckPointable {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using CheckPointHistoryCache for CheckPointHistoryCache.CacheState;
    using SafeMath for uint256;

    // Private member variables
    CheckPointsByAddress.CheckPointsByAddressState private _balanceHistory;
    CheckPointHistory.CheckPointHistoryState private _totalSupply;
    CheckPointHistoryCache.CacheState private _totalSupplyCache;

    /**
     * @dev Queries the token balance of `owner` at a specific `blockNumber`.
     * @param owner The address from which the balance will be retrieved.
     * @param blockNumber The block number when the balance is queried.
     * @return balance The balance at `blockNumber`.
     **/
    function balanceOfAt(address owner, uint blockNumber) public virtual view returns (uint256 balance) {
        return _balanceHistory.valueOfAt(owner, blockNumber);
    }

    /**
     * @notice Burn current token `amount` for `owner` of checkpoints at current block.
     * @param owner The address of the owner to burn tokens.
     * @param amount The amount to burn.
     */
    function _burnForAtNow(address owner, uint256 amount) internal virtual {
        _balanceHistory.writeValueOfAtNow(
            owner, 
            balanceOfAt(owner, block.number).sub(amount, "Burn too big for owner")
        );
        _totalSupply.writeValue(totalSupplyAt(block.number).sub(amount, "Burn too big for total supply"));
    }

    /**
     * @notice Mint current token `amount` for `owner` of checkpoints at current block.
     * @param owner The address of the owner to burn tokens.
     * @param amount The amount to burn.
     */
    function _mintForAtNow(address owner, uint256 amount) internal virtual {
        _balanceHistory.writeValueOfAtNow(owner, balanceOfAt(owner, block.number).add(amount));
        _totalSupply.writeValue(totalSupplyAt(block.number).add(amount));
    }

    /**
     * @notice Total amount of tokens at a specific `blockNumber`.
     * @param blockNumber The block number when the totalSupply is queried
     * @return totalSupply The total amount of tokens at `blockNumber`
     **/
    function totalSupplyAt(uint blockNumber) public virtual view returns(uint256 totalSupply) {
        return _totalSupply.valueAt(blockNumber);
    }

    /**
     * @notice Total amount of tokens at a specific `blockNumber`.
     * @param blockNumber The block number when the totalSupply is queried
     * @return totalSupply The total amount of tokens at `blockNumber`
     **/
    function _totalSupplyAtCached(uint blockNumber) internal returns(uint256 totalSupply) {
        // use cache only for the past (the value will never change)
        require(blockNumber < block.number, "Can only be used for past blocks");
        return _totalSupplyCache.valueAt(_totalSupply, blockNumber);
    }

    /**
     * @notice Transmit token `amount` `from` address `to` address of checkpoints at current block.
     * @param from The address of the sender.
     * @param to The address of the receiver.
     * @param amount The amount to transmit.
     */
    function _transmitAtNow(address from, address to, uint256 amount) internal virtual {
        _balanceHistory.transmit(from, to, amount);
    }
}