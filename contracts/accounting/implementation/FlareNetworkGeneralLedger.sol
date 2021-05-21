// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { AccountDefinition } from "../lib/AccountingStructs.sol";
import { Accounting } from "./Accounting.sol";
import { FlareNetworkChartOfAccounts } from "../lib/FlareNetworkChartOfAccounts.sol";
import { Ledger } from "./Ledger.sol";
import { JournalEntry } from "../lib/AccountingStructs.sol";
 
/**
 * @title Flare Network General Ledger
 * @notice This contract implements a default GL for the Flare Network with access control.
 **/
contract FlareNetworkGeneralLedger is Accounting, Ledger {
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    modifier onlyMaintainers () {
        require (hasRole(MAINTAINER_ROLE, msg.sender), "not maintainer");
        _;
    }

    constructor(address _governance)
        Accounting(_governance)
        Ledger("Flare Network") {
        _setupRole(MAINTAINER_ROLE, _governance);
        addAccounts(FlareNetworkChartOfAccounts.getAccountDefinitions());
    }

    function addAccount(AccountDefinition memory _accountDefinition) public override onlyMaintainers {
        super.addAccount(_accountDefinition);
    }

    function addAccounts(AccountDefinition[] memory _accountDefinitions) public override onlyMaintainers {
        super.addAccounts(_accountDefinitions);
    }

    function post(JournalEntry[] calldata _journalEntries) public override onlyPosters {
        super.post(_journalEntries);
    }
}
