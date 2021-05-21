// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

enum AccountType { ASSET, LIABILITY, EQUITY }

/**
    * @dev `LedgerEntry` A debit or credit entry for an Account at a block point in time.
    */
struct LedgerEntry {
    uint256 blockNumber;
    uint256 debit;
    uint256 credit;
    int256 runningBalance;
}

struct JournalEntry {
    bytes32 accountName;
    uint256 debit;
    uint256 credit;
}

struct AccountDefinition {
    bytes32 name;
    AccountType accountType;
}
