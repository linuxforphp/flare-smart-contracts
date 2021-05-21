// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { AccountType, LedgerEntry } from "./AccountingStructs.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

// import "hardhat/console.sol";
/**
 * @title Account library
 * @notice Represents a simple double entry bookeeping account.
 * @dev This library is meant to be instantiated inside a Ledger contract.
 **/
library Account {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using SignedSafeMath for int256;

    uint256 private constant NOT_FOUND = uint256(-1);

    /**
     * @dev `AccountState` is state structure used by this library to manage an account balance.
     */
    struct AccountState {
        bytes32 name;
        // This should not be changable...must be enforced by consumer
        AccountType accountType;
        int256 currentBalance;
        // mapping(uint256 => int256) runningBalanceByBlock;
        LedgerEntry[] ledgerEntries;
    }

    function init(AccountState storage _self, bytes32 _name, AccountType _accountType) internal {
        _self.name = _name;
        _self.accountType = _accountType;
    }

    function debit(AccountState storage _self, uint256 _amount) internal {      
        if(_self.ledgerEntries.length > 0 &&  
            _self.ledgerEntries[_self.ledgerEntries.length - 1].blockNumber == block.number)
        {   // reuse the same ledger entry for a block
            LedgerEntry storage lastEntry = _self.ledgerEntries[_self.ledgerEntries.length - 1];
            lastEntry.debit = lastEntry.debit.add(_amount);
            if (_self.accountType == AccountType.ASSET) {
                _self.currentBalance = _self.currentBalance.add(_amount.toInt256());
            } else {
                _self.currentBalance = _self.currentBalance.sub(_amount.toInt256());
            }
            lastEntry.runningBalance = _self.currentBalance;
        } else {
            LedgerEntry memory lastEntry = LedgerEntry({
                blockNumber: block.number, 
                debit: _amount, 
                credit: 0, 
                runningBalance: 0
            });
            if (_self.accountType == AccountType.ASSET) {
                _self.currentBalance = _self.currentBalance.add(_amount.toInt256());
            } else {
                _self.currentBalance = _self.currentBalance.sub(_amount.toInt256());
            }
            lastEntry.runningBalance = _self.currentBalance;
            _self.ledgerEntries.push(lastEntry);
        }                
    }

    function credit(AccountState storage _self, uint256 _amount) internal {
        if(_self.ledgerEntries.length > 0 &&  
            _self.ledgerEntries[_self.ledgerEntries.length - 1].blockNumber == block.number)
        {   // reuse the same ledger entry for a block
            LedgerEntry storage lastEntry = _self.ledgerEntries[_self.ledgerEntries.length - 1];
            lastEntry.credit = lastEntry.credit.add(_amount);
            if (_self.accountType == AccountType.ASSET) {
                _self.currentBalance = _self.currentBalance.sub(_amount.toInt256());
            } else {
                _self.currentBalance = _self.currentBalance.add(_amount.toInt256());
            }
            lastEntry.runningBalance = _self.currentBalance;
        } else {
            LedgerEntry memory lastEntry = LedgerEntry({
                blockNumber: block.number, 
                debit: 0, 
                credit: _amount, 
                runningBalance: 0
            });
            if (_self.accountType == AccountType.ASSET) {
                _self.currentBalance = _self.currentBalance.sub(_amount.toInt256());
            } else {
                _self.currentBalance = _self.currentBalance.add(_amount.toInt256());
            }
            lastEntry.runningBalance = _self.currentBalance;
            _self.ledgerEntries.push(lastEntry);
        }
    }

    function _indexOfGreatestBlockLessThan(
        LedgerEntry[] storage ledgerEntries, 
        uint256 blockNumber
    ) private view returns (uint256 index) {
        // Binary search of the value by given block number in the array
        uint256 min = 0;
        uint256 max = ledgerEntries.length.sub(1);
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (ledgerEntries[mid].blockNumber <= blockNumber) {
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    function _indexOfGreatestBlockLessThanIfExists(
        LedgerEntry[] storage ledgerEntries, 
        uint256 blockNumber
    ) private view returns (uint256 index) {
        uint256 entriesCount = ledgerEntries.length;
        if (entriesCount == 0) {
            return NOT_FOUND;
        } else if (blockNumber >= ledgerEntries[entriesCount - 1].blockNumber) {
            return entriesCount - 1;
        } else if (blockNumber < ledgerEntries[0].blockNumber) {
            return NOT_FOUND;
        } else {
            return _indexOfGreatestBlockLessThan(ledgerEntries, blockNumber);
        }
    }

    function getBalanceAt(AccountState storage _self, uint256 blockNumber) external view returns (int256){
        uint index = _indexOfGreatestBlockLessThanIfExists(_self.ledgerEntries, blockNumber);
        if (index == NOT_FOUND) return 0;
        return _self.ledgerEntries[index].runningBalance;
    }
}