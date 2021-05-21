// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { Account, AccountType, LedgerEntry } from "../../accounting/lib/Account.sol";

/**
 * @title Account Mock contract
 * @notice A contract to proxy call the Account library for unit testing.
 **/
contract AccountMock {
    using Account for Account.AccountState;

    Account.AccountState private _state;

    constructor(bytes32 _name, AccountType _accountType) {
        _state.init(_name, _accountType);
    }

    function debit(uint256 _amount) public {
        _state.debit(_amount);
    }

    function credit(uint256 _amount) public {
        _state.credit(_amount);
    }

    function currentBalance() public view returns(int256) {
        return _state.currentBalance;
    }

    function ledgerEntries(uint256 index) public view returns(LedgerEntry memory) {
        return _state.ledgerEntries[index];
    }
}
