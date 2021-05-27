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
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

// import "hardhat/console.sol";

/**
 * @title Ledger
 * @notice This contract represents an accounting ledger with a chart of accounts.
 **/
contract Ledger {
    using Account for Account.AccountState;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    string public name;

    // TODO: Make EnumerableStringToAccountMap library
    mapping(bytes32 => Account.AccountState) internal chartOfAccounts;
    bytes32[] internal accountNames;

    uint256 public assetBalance;
    uint256 public liabilityBalance;
    uint256 public equityBalance;

    uint256 internal constant MAX_JOURNAL_ENTRIES = 20;
    uint256 internal constant MAX_ACCOUNTS = 100;

    string internal constant ERR_TOO_MANY_MSG = "too many";
    string internal constant ERR_GOLDEN_RULE_MSG = "assets != liability + equity";
    string internal constant ERR_NOT_FOUND_MSG = "not found";
    string internal constant ERR_DEBITS_NEQ_CREDITS_MSG = "debits != credits";
    string internal constant ERR_ALREADY_ADDED_MSG = "already added";

    modifier mustBalance {
        _;
        require(assetBalance == liabilityBalance.add(equityBalance), ERR_GOLDEN_RULE_MSG);
    }

    modifier mustBeBounded(uint256 _length, uint256 _limit) {
        require (_length <= _limit, ERR_TOO_MANY_MSG);
        _;
    }

    modifier mustExist(bytes32 _accountName) {
        require(accountExists(_accountName), ERR_NOT_FOUND_MSG);
        _;
    }

    modifier mustNotExist(bytes32 _accountName) {
        require(!accountExists(_accountName), ERR_ALREADY_ADDED_MSG);
        _;
    }

    constructor(string memory _name) {
        name = _name;
    }

    function addAccount(AccountDefinition memory _accountDefinition)
        public virtual 
        mustNotExist(_accountDefinition.name)
    {

        Account.AccountState storage account = chartOfAccounts[_accountDefinition.name];
        account.init(_accountDefinition.name, _accountDefinition.accountType);
        accountNames.push(_accountDefinition.name);
    }

    function addAccounts(AccountDefinition[] memory _accountDefinitions)
        public virtual 
        mustBeBounded(_accountDefinitions.length, MAX_ACCOUNTS)
    {
        uint256 count = _accountDefinitions.length;
        for(uint256 i = 0; i < count; i++) {
            addAccount(_accountDefinitions[i]);
        }
    }

    function getCurrentBalance(bytes32 _forAccountName)
        external view 
        mustExist(_forAccountName)
        returns(int256)
    {
        Account.AccountState storage account = chartOfAccounts[_forAccountName];
        return account.currentBalance;
    }

    function getBalanceAt(bytes32 _forAccountName, uint256 blockNumber)
        external view 
        mustExist(_forAccountName)
        returns(int256)
    {
        Account.AccountState storage account = chartOfAccounts[_forAccountName];
        return account.getBalanceAt(blockNumber);
    }

    function getLedgerEntry(bytes32 _forAccountName, uint256 index)
        external view 
        mustExist(_forAccountName)
        returns(LedgerEntry memory)
    {
        Account.AccountState storage account = chartOfAccounts[_forAccountName];
        return account.ledgerEntries[index];
    }

    function getAccountName(uint256 index) external view returns(bytes32) {
        return accountNames[index];
    }

    function getAccountNames() external view returns(bytes32[] memory) {
        return accountNames;
    }

    /**
        - Check that sum of debits = credits
        - Check that all accounts exist in chart of accounts
        - Make entries to accounts
        - Update asset, liability, and equity totals.
     */
    function post(JournalEntry[] calldata journalEntries)
        public virtual
        mustBeBounded(journalEntries.length, MAX_JOURNAL_ENTRIES)
        mustBalance 
    {
        uint256 debits;
        uint256 credits;

        uint256 count = journalEntries.length;

        // Check that sum of debits = credits
        // Check that all accounts exist in chart of accounts
        for (uint i = 0; i < count; i++) {
            JournalEntry calldata journalEntry = journalEntries[i];
            require(accountExists(journalEntry.accountName), ERR_NOT_FOUND_MSG);
            debits += journalEntry.debit;
            credits += journalEntry.credit;
        }
        require(debits == credits, ERR_DEBITS_NEQ_CREDITS_MSG);

        // Post
        int256 assetBalanceDifference;
        int256 liabilityBalanceDifference;
        int256 equityBalanceDifference;

        for (uint i = 0; i < count; i++) {
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
            int256 difference = closingBalance.sub(openingBalance);
            // Update accounting journal totals based on changes to each account
            if (account.accountType == AccountType.ASSET) {       
                assetBalanceDifference = assetBalanceDifference.add(difference);
            } else if (account.accountType == AccountType.LIABILITY) {
                liabilityBalanceDifference = liabilityBalanceDifference.add(difference);
            } else if (account.accountType == AccountType.EQUITY) {
                equityBalanceDifference = equityBalanceDifference.add(difference);
            } else {
                assert(false);
            }
        }
        if (assetBalanceDifference < 0) {
            assetBalance = assetBalance.sub(uint256(assetBalanceDifference * -1));
        } else {
            assetBalance = assetBalance.add(uint256(assetBalanceDifference));
        }
        if (liabilityBalanceDifference < 0) {
            liabilityBalance = liabilityBalance.sub(uint256(liabilityBalanceDifference * -1));
        } else {
            liabilityBalance = liabilityBalance.add(uint256(liabilityBalanceDifference));
        }
        if (equityBalanceDifference < 0) {
            equityBalance = equityBalance.sub(uint256(equityBalanceDifference * -1));
        } else {
            equityBalance = equityBalance.add(uint256(equityBalanceDifference));
        }
    } 

    function accountExists(bytes32 _name) public view returns(bool) {
        return chartOfAccounts[_name].name == _name;
    }

}
