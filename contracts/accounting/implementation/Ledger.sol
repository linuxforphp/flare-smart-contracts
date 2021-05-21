// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { Account } from "../lib/Account.sol";
import { 
    AccountDefinition, 
    AccountType, 
    LedgerEntry, 
    JournalEntry } from "../lib/AccountingStructs.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Ledger
 * @notice This contract represents an accounting ledger with a chart of accounts.
 **/

contract Ledger {
    using Account for Account.AccountState;
    using SafeMath for uint256;

    string public name;

    // TODO: Make EnumerableStringToAccountMap library
    mapping(bytes32 => Account.AccountState) internal chartOfAccounts;
    bytes32[] internal accountNames;

    uint256 public assetBalance;
    uint256 public liabilityBalance;
    uint256 public equityBalance;

    modifier mustBalance {
        _;
        require(assetBalance == liabilityBalance.add(equityBalance), "assets != liability + equity");
    }

    constructor(string memory _name) {
        name = _name;
    }

    function addAccount(AccountDefinition memory _accountDefinition) public virtual {
        // TODO: spit out name, as this may be called with a bunch of accounts to add
        require(!accountExists(_accountDefinition.name), "already added");

        Account.AccountState storage account = chartOfAccounts[_accountDefinition.name];
        account.init(_accountDefinition.name, _accountDefinition.accountType);
        accountNames.push(_accountDefinition.name);
    }

    function addAccounts(AccountDefinition[] memory _accountDefinitions) public virtual {
        uint256 count = _accountDefinitions.length;
        for(uint256 i = 0; i < count; i++) {
            addAccount(_accountDefinitions[i]);
        }
    }

    function getCurrentBalance(bytes32 _forAccountName) external view returns(int256) {
        require(accountExists(_forAccountName), "not found");
        Account.AccountState storage account = chartOfAccounts[_forAccountName];
        return account.currentBalance;
    }

    function getLedgerEntry(bytes32 _forAccountName, uint256 index) external view returns(LedgerEntry memory) {
        require(accountExists(_forAccountName), "not found");
        Account.AccountState storage account = chartOfAccounts[_forAccountName];
        return account.ledgerEntries[index];
    }

    function getAccountName(uint256 index) external view returns(bytes32) {
        return accountNames[index];
    }

    function getAccountNames() external view returns(bytes32[] memory) {
        return accountNames;
    }

    // Open and close methods support the notion of sub-ledgers, where we accumulate detailed journal entries
    // over time, but then don't want to clutter the general ledger with all the detail. We could periodically
    // roll up the detail, post the summary to the GL, and then flush the detail in the sub-ledger. I am thinking
    // of claims in particular.
    
    /* solhint-disable no-unused-vars */

    /**
        - Store all currnet balances as closing balances
        - Spin through all accounts and compute the difference between opening balance and closing balance.
        - Make journal entries to parent ledger posting all differences for all accounts.
        - Clear detail
        - Make new journal entry to establish new opening balances from stored closing balances
        - NOTE: This could be divided up between a close and roll feature, in the event one wants to 
        - snapshot closing balance and post to GL without clearing detail. Then the opening balance pointer
        - just has to be moved.
     */
    // function close(Ledger parentLedger) external pure {
    //     require(false, "not implemented");
    // }

    /**
        - take in a parent ledger, get the balances of accountNames from the parent
        - create accounts in this sub-ledger for all accountNames
        - create a journal entry for all current balances
        - set pointer to opening balance (this will need some mods to Account, I think)
     */
    // function open(Ledger parentLedger, bytes32[] calldata accountNames) external pure {
    //     require(false, "not implemented");
    // }
    
    /* solhint-enable no-unused-vars */

    /**
        - Check that sum of debits = credits
        - Check that all accounts exist in chart of accounts
        - Make entries to accounts
        - Update asset, liability, and equity totals.
     */
    function post(JournalEntry[] calldata journalEntries) public virtual mustBalance {
        uint256 debits;
        uint256 credits;

        // Check that sum of debits = credits
        // Check that all accounts exist in chart of accounts
        for (uint i = 0; i < journalEntries.length; i++) {
            JournalEntry calldata journalEntry = journalEntries[i];
            // TODO: Which account?
            require(accountExists(journalEntry.accountName), "account missing");
            debits += journalEntry.debit;
            credits += journalEntry.credit;
        }
        require(debits == credits, "debits != credits");

        // Post
        for (uint i = 0; i < journalEntries.length; i++) {
            // Post journal entries to accounts
            JournalEntry calldata journalEntry = journalEntries[i];
            Account.AccountState storage account = chartOfAccounts[journalEntry.accountName];
            int256 openingBalance = account.currentBalance;
            if (journalEntry.credit > 0) {
                account.credit(journalEntry.credit);
            }
            if (journalEntry.debit > 0) {
                account.debit(journalEntry.debit);
            }
            
            int256 closingBalance = account.currentBalance;
            int256 difference = closingBalance - openingBalance;
            bool differenceNegative = difference < 0 ? true : false;
            // Update accounting journal totals based on changes to each account
            if (account.accountType == AccountType.ASSET) {
                if (differenceNegative) {
                    assetBalance = assetBalance.sub(uint256(difference * -1));
                } else {
                    assetBalance = assetBalance.add(uint256(difference));
                }
            } else if (account.accountType == AccountType.LIABILITY) {
                if (differenceNegative) {
                    liabilityBalance = liabilityBalance.sub(uint256(difference * -1));
                } else {
                    liabilityBalance = liabilityBalance.add(uint256(difference));
                }
            } else if (account.accountType == AccountType.EQUITY) {
                if (differenceNegative) {
                    equityBalance = equityBalance.sub(uint256(difference * -1));
                } else {
                    equityBalance = equityBalance.add(uint256(difference));
                }
            } else {
                assert(false);
            }
        }
    } 

    function accountExists(bytes32 _name) public view returns(bool) {
        return chartOfAccounts[_name].name == _name;
    }
}
