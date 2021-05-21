// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {VotePower} from "../lib/VotePower.sol";

/**
 * @title Vote power library
 * @notice A library to record delegate vote power balances by delegator 
 *  and delegatee.
 **/
library VotePowerCache {
    using SafeMath for uint256;
    using VotePower for VotePower.VotePowerState;

    struct RevocationCacheRecord {
        // the total value this delegator has revoked from delegatees
        uint256 revokedTotal;
        
        // revoking delegation only affects cached value therefore we have to track
        // the revocation in order not to revoke twice
        // mapping delegatee => isRevoked?
        mapping (address => bool) revocations;
    }
    
    /**
     * @dev `CacheState` is state structure used by this library to manage vote
     *  power amounts by delegator and it's delegates.
     */
    struct CacheState {
        // map keccak256([address, blockNumber]) -> (value + 1)
        mapping (bytes32 => uint256) valueCache;
        
        // map keccak256([address, blockNumber]) -> RevocationCacheRecord
        mapping (bytes32 => RevocationCacheRecord) revocationCache;
    }

    /**
    * @notice Get the cached value at given block. If there is no cached value, original
    *    value is returned and stored to cache. Cache never gets stale, because original
    *    value can never change in a past block.
    * @param self A VotePowerCache instance to manage.
    * @param votePower A VotePower instance to read from if cache is empty.
    * @param who Address to get vote power.
    * @param blockNumber Block number of the block to fetch vote power.
    * precondition: blockNumber < block.number
    */
    function valueOfAt(
        CacheState storage self,
        VotePower.VotePowerState storage votePower,
        address who,
        uint256 blockNumber
    ) internal returns (uint256 value) {
        bytes32 key = keccak256(abi.encode(who, blockNumber));
        // is it in cache?
        uint256 cachedValue = self.valueCache[key];
        if (cachedValue != 0) {
            return cachedValue - 1;
        }
        // read from votePower
        uint256 votePowerValue = votePower.votePowerOfAt(who, blockNumber);
        writeCacheValue(self, key, votePowerValue);
        return votePowerValue;
    }

    /**
    * @notice Get the cached value at given block. If there is no cached value, original
    *    value is returned. Cache is never modified.
    * @param self A VotePowerCache instance to manage.
    * @param votePower A VotePower instance to read from if cache is empty.
    * @param who Address to get vote power.
    * @param blockNumber Block number of the block to fetch vote power.
    * precondition: blockNumber < block.number
    */
    function valueOfAtReadonly(
        CacheState storage self,
        VotePower.VotePowerState storage votePower,
        address who,
        uint256 blockNumber
    ) internal view returns (uint256 value) {
        bytes32 key = keccak256(abi.encode(who, blockNumber));
        // is it in cache?
        uint256 cachedValue = self.valueCache[key];
        if (cachedValue != 0) {
            return cachedValue - 1;
        }
        // read from votePower
        return votePower.votePowerOfAt(who, blockNumber);
    }
    
    /**
    * @notice Revoke vote power delegation from `from` to `to` at given block.
    *   Updates cached values so they are the only vote power values respecting revocation.
    * @param self A VotePowerCache instance to manage.
    * @param votePower A VotePower instance to read from if cache is empty.
    * @param from The delegator.
    * @param to The delegatee.
    * @param revokedValue Value of delegation is not stored here, so it must be supplied by caller.
    * @param blockNumber Block number of the block to modify.
    * precondition: blockNumber < block.number
    */
    function revokeAt(
        CacheState storage self,
        VotePower.VotePowerState storage votePower,
        address from,
        address to,
        uint256 revokedValue,
        uint256 blockNumber
    ) internal {
        if (revokedValue == 0) return;
        bytes32 keyFrom = keccak256(abi.encode(from, blockNumber));
        if (self.revocationCache[keyFrom].revocations[to]) {
            revert("Already revoked");
        }
        // read values and prime cacheOf
        uint256 valueFrom = valueOfAt(self, votePower, from, blockNumber);
        uint256 valueTo = valueOfAt(self, votePower, to, blockNumber);
        // write new values
        bytes32 keyTo = keccak256(abi.encode(to, blockNumber));
        self.revocationCache[keyFrom].revokedTotal = self.revocationCache[keyFrom].revokedTotal.add(revokedValue);
        writeCacheValue(self, keyFrom, valueFrom.add(revokedValue));
        writeCacheValue(self, keyTo, valueTo.sub(revokedValue, "Revoked value too large"));
        // mark as revoked
        self.revocationCache[keyFrom].revocations[to] = true;
    }

    /**
    * @notice Return the sum of vote power that `from` has revoked from delgatees.
    * @param self A VotePowerCache instance to manage.
    * @param from The delegator.
    * @param blockNumber Block number of the block to fetch result.
    * precondition: blockNumber < block.number
    */
    function revokedTotalFromAt(
        CacheState storage self,
        address from,
        uint256 blockNumber
    ) internal view returns (uint256 total) {
        bytes32 keyFrom = keccak256(abi.encode(from, blockNumber));
        return self.revocationCache[keyFrom].revokedTotal;
    }
    
    /**
    * @notice Returns true if `from` has revoked vote pover delgation of `to` in block `blockNumber`.
    * @param self A VotePowerCache instance to manage.
    * @param from The delegator.
    * @param to The delegatee.
    * @param blockNumber Block number of the block to fetch result.
    * precondition: blockNumber < block.number
    */
    function revokedFromToAt(
        CacheState storage self,
        address from,
        address to,
        uint256 blockNumber
    ) internal view returns (bool revoked) {
        bytes32 keyFrom = keccak256(abi.encode(from, blockNumber));
        return self.revocationCache[keyFrom].revocations[to];
    }
    
    function writeCacheValue(CacheState storage self, bytes32 key, uint256 value) private {
        // store to cacheOf (add 1 to differentiate from empty)
        self.valueCache[key] = value.add(1);
    }
}
