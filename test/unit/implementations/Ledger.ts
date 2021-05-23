import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { LedgerContract, LedgerInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";
import { AccountType } from "../../utils/Accounting";
const {expectRevert, expectEvent} = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const Ledger = artifacts.require("Ledger") as LedgerContract;

const AN_ASSET = keccak256(toUtf8Bytes("AnAsset"));
const A_CONTRA_ASSET = keccak256(toUtf8Bytes("AContraAsset"));
const A_LIABILITY = keccak256(toUtf8Bytes("ALiability"));
const A_CONTRA_LIABILITY = keccak256(toUtf8Bytes("AContraLiability"));
const SOME_EQUITY = keccak256(toUtf8Bytes("SomeEquity"));
const CONTRA_EQUITY = keccak256(toUtf8Bytes("ContraEquity"));
const BOGUS_ACCOUNT = keccak256(toUtf8Bytes("BogusAccount"));

contract(`Ledger.sol; ${getTestFile(__filename)}; Ledger unit tests`, async accounts => {
  let ledger: LedgerInstance;

  beforeEach(async() => {
    ledger = await Ledger.new("A Ledger");
  });

  describe("Accounts", async() => {
    it("Should add an account", async() => {
      // Assemble
      // Act
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      // Assert
      assert.equal(await ledger.getAccountName(0), AN_ASSET);
    });

    it("Should not add a duplicate account name", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      // Act
      const addAccountPromise = ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      // Assert
      await expectRevert(addAccountPromise, "already added");
    });

    it("Should fetch all account names", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      await ledger.addAccount({name: A_LIABILITY, accountType: AccountType.LIABILITY});
      // Act
      const accountNames = await ledger.getAccountNames();
      // Assert
      assert.equal(accountNames[0], AN_ASSET);
      assert.equal(accountNames[1], A_LIABILITY);
    });

    it("Should add multiple accounts", async() => {
      // Assemble
      const accountDefinitions = [];
      accountDefinitions[0] = {name: AN_ASSET, accountType: AccountType.ASSET};
      accountDefinitions[1] = {name: A_LIABILITY, accountType: AccountType.LIABILITY};
      // Act
      await ledger.addAccounts(accountDefinitions);
      // Assert
      const accountNames = await ledger.getAccountNames();
      assert.equal(accountNames[0], AN_ASSET);
      assert.equal(accountNames[1], A_LIABILITY);
    });

    it("Should not add too many accounts", async() => {
      // Assemble
      const accountDefinitions = [];
      for (let i = 0; i <= 100; i++) {
        accountDefinitions[i] = {name: keccak256(toUtf8Bytes(`Asset ${i}`)), accountType: AccountType.ASSET};
      }
      // Act
      const addAccountsPromise = ledger.addAccounts(accountDefinitions);
      // Assert
      await expectRevert(addAccountsPromise, "too many");
    });
  });

  describe("Post", async() => {
    it("Should revert if debits != credits", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      const journalEntry = { accountName: AN_ASSET, debit: 100, credit: 0};
      const journalEntries = [];
      journalEntries[0] = journalEntry;
      // Act
      const postPromise = ledger.post(journalEntries);
      // Assert
      await expectRevert(postPromise, "debits != credits");
    });

    // It is impossible to test for this condition unless
    // journal entries are edited in situ. Debits always = credits.
    it.skip("Should revert if assets != liability + equity", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      // One journal entry would do it, but nets to zero, so no change in asset balance.
      const journalEntry = { accountName: AN_ASSET, debit: 100, credit: 100};
      const journalEntries = [];
      journalEntries[0] = journalEntry;
      // Act
      const postPromise = ledger.post(journalEntries);
      // Assert
      await expectRevert(postPromise, "assets != liability + equity");
    });

    it("Should revert if account not found", async() => {
      // Assemble
      const journalEntry = { accountName: AN_ASSET, debit: 100, credit: 0};
      const journalEntries = [];
      journalEntries[0] = journalEntry;
      // Act
      const postPromise = ledger.post(journalEntries);
      // Assert
      await expectRevert(postPromise, `not found`);
    });

    it("Should update asset, liability, and equity ledger balances when posting", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      await ledger.addAccount({name: SOME_EQUITY, accountType: AccountType.EQUITY});
      await ledger.addAccount({name: A_LIABILITY, accountType: AccountType.LIABILITY});
      const journalEntry0 = { accountName: AN_ASSET, debit: 100, credit: 0};
      const journalEntry1 = { accountName: SOME_EQUITY, debit: 0, credit: 100};
      const journalEntry2 = { accountName: AN_ASSET, debit: 50, credit: 0};
      const journalEntry3 = { accountName: A_LIABILITY, debit: 0, credit: 50};
      const journalEntries = [];
      journalEntries[0] = journalEntry0;
      journalEntries[1] = journalEntry1;
      journalEntries[2] = journalEntry2;
      journalEntries[3] = journalEntry3;
      // Act
      await ledger.post(journalEntries);
      // Assert
      const assetBalance = await ledger.assetBalance();
      const equityBalance = await ledger.equityBalance();
      const liabilityBalance = await ledger.liabilityBalance();
      assert.equal(assetBalance.toNumber(), 150);
      assert.equal(equityBalance.toNumber(), 100);
      assert.equal(liabilityBalance.toNumber(), 50);
    });

    it("Should record ledger entries to accounts in same block", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      const journalEntry0 = { accountName: AN_ASSET, debit: 100, credit: 100};
      const journalEntries = [];
      journalEntries[0] = journalEntry0;
      // Act
      await ledger.post(journalEntries);
      // Assert
      const ledgerEntry0 = await ledger.getLedgerEntry(AN_ASSET, 0);
      // const ledgerEntry1 = await ledger.getLedgerEntry(AN_ASSET, 1);
      assert(ledgerEntry0.blockNumber != toBN(0));
      assert.equal(ledgerEntry0.credit, toBN(100));
      assert.equal(ledgerEntry0.debit, toBN(100));
      assert.equal(ledgerEntry0.runningBalance, toBN(0));
    })

    it("Should record ledger entries to accounts in two blocks", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      const journalEntry0 = { accountName: AN_ASSET, debit: 100, credit: 0};
      const journalEntry1 = { accountName: AN_ASSET, debit: 0, credit: 100};
      const journalEntry2 = { accountName: AN_ASSET, debit: 20, credit: 0};
      const journalEntry3 = { accountName: AN_ASSET, debit: 0, credit: 20};

      // Act
      await ledger.post([journalEntry0, journalEntry1]);
      await ledger.post([journalEntry2, journalEntry3]);
      // Assert
      const ledgerEntry0 = await ledger.getLedgerEntry(AN_ASSET, 0);
      const ledgerEntry1 = await ledger.getLedgerEntry(AN_ASSET, 1);
      assert(ledgerEntry0.blockNumber != toBN(0));
      assert(ledgerEntry1.blockNumber != toBN(0));
      assert(parseInt(ledgerEntry0.blockNumber as any) + 1 == parseInt(ledgerEntry1.blockNumber as any));
      assert.equal(ledgerEntry0.credit, toBN(100));
      assert.equal(ledgerEntry0.debit, toBN(100));
      assert.equal(ledgerEntry0.runningBalance, toBN(0));
      assert.equal(ledgerEntry1.credit, toBN(20));
      assert.equal(ledgerEntry1.debit, toBN(20));
      assert.equal(ledgerEntry1.runningBalance, toBN(0));

    })

    it("Should increase an asset when debiting and decrease when crediting", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      await ledger.addAccount({name: A_CONTRA_ASSET, accountType: AccountType.ASSET});
      const journalEntry0 = { accountName: AN_ASSET, debit: 100, credit: 0};
      const journalEntry1 = { accountName: A_CONTRA_ASSET, debit: 0, credit: 100};
      const journalEntries = [];
      journalEntries[0] = journalEntry0;
      journalEntries[1] = journalEntry1;
      // Act
      await ledger.post(journalEntries);
      // Assert
      const anAssetBalance = await ledger.getCurrentBalance(AN_ASSET);
      const aContraAssetBalance = await ledger.getCurrentBalance(A_CONTRA_ASSET);
      assert.equal(anAssetBalance.toNumber(), 100);
      assert.equal(aContraAssetBalance.toNumber(), -100);
    });

    it("Should decrease a liability when debiting and increase when crediting", async() => {
      // Assemble
      await ledger.addAccount({name: A_LIABILITY, accountType: AccountType.LIABILITY});
      await ledger.addAccount({name: A_CONTRA_LIABILITY, accountType: AccountType.LIABILITY});
      const journalEntry0 = { accountName: A_LIABILITY, debit: 0, credit: 100};
      const journalEntry1 = { accountName: A_CONTRA_LIABILITY, debit: 100, credit: 0};
      const journalEntries = [];
      journalEntries[0] = journalEntry0;
      journalEntries[1] = journalEntry1;
      // Act
      await ledger.post(journalEntries);
      // Assert
      const aLiabilityBalance = await ledger.getCurrentBalance(A_LIABILITY);
      const aContraLiabilityBalance = await ledger.getCurrentBalance(A_CONTRA_LIABILITY);
      assert.equal(aLiabilityBalance.toNumber(), 100);
      assert.equal(aContraLiabilityBalance.toNumber(), -100);
    });    

    it("Should decrease equity when debiting and increase when crediting", async() => {
      // Assemble
      await ledger.addAccount({name: SOME_EQUITY, accountType: AccountType.EQUITY});
      await ledger.addAccount({name: CONTRA_EQUITY, accountType: AccountType.EQUITY});
      const journalEntry0 = { accountName: SOME_EQUITY, debit: 0, credit: 100};
      const journalEntry1 = { accountName: CONTRA_EQUITY, debit: 100, credit: 0};
      const journalEntries = [];
      journalEntries[0] = journalEntry0;
      journalEntries[1] = journalEntry1;
      // Act
      await ledger.post(journalEntries);
      // Assert
      const someEquityBalance = await ledger.getCurrentBalance(SOME_EQUITY);
      const contraEquityBalance = await ledger.getCurrentBalance(CONTRA_EQUITY);
      assert.equal(someEquityBalance.toNumber(), 100);
      assert.equal(contraEquityBalance.toNumber(), -100);
    });
    
    it("Should revert when adding an invalid account type", async() => {
      // Assemble
      // Act
      const addPromise = ledger.addAccount({name: BOGUS_ACCOUNT, accountType: AccountType.BOGUS});
      // Assert
      await expectRevert.unspecified(addPromise);
    });

    it("Should not add too many ledger entries", async() => {
      // Assemble
      await ledger.addAccount({name: SOME_EQUITY, accountType: AccountType.EQUITY});
      const journalEntries = [];
      for (let i = 0; i <= 20; i++) {
        journalEntries[i] = { accountName: SOME_EQUITY, debit: 100, credit: 100};
      }
      // Act
      const postPromise = ledger.post(journalEntries);
      // Assert
      await expectRevert(postPromise, "too many");
    });

    it("Should revert when driving asset total negative", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      await ledger.addAccount({name: A_LIABILITY, accountType: AccountType.LIABILITY});
      // This will create negative total assets since it is first in the list
      const journalEntries = [];
      journalEntries[0] = { accountName: AN_ASSET, debit: 0, credit: 100};
      journalEntries[1] = { accountName: A_LIABILITY, debit: 100, credit: 0};
      // Act
      const postPromise = ledger.post(journalEntries);
      // Assert
      await expectRevert(postPromise, "SafeMath: subtraction overflow");
    });

    it("Should revert when driving liability total negative", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      await ledger.addAccount({name: A_LIABILITY, accountType: AccountType.LIABILITY});
      // This will create negative total assets since it is first in the list
      const journalEntries = [];
      journalEntries[0] = { accountName: A_LIABILITY, debit: 100, credit: 0};
      journalEntries[1] = { accountName: AN_ASSET, debit: 0, credit: 100};
      // Act
      const postPromise = ledger.post(journalEntries);
      // Assert
      await expectRevert(postPromise, "SafeMath: subtraction overflow");
    });    

    it("Should revert when driving equity total negative", async() => {
      // Assemble
      await ledger.addAccount({name: AN_ASSET, accountType: AccountType.ASSET});
      await ledger.addAccount({name: SOME_EQUITY, accountType: AccountType.EQUITY});
      // This will create negative total equity since it is first in the list
      const journalEntries = [];
      journalEntries[0] = { accountName: SOME_EQUITY, debit: 100, credit: 0};
      journalEntries[1] = { accountName: AN_ASSET, debit: 0, credit: 100};
      // Act
      const postPromise = ledger.post(journalEntries);
      // Assert
      await expectRevert(postPromise, "SafeMath: subtraction overflow");
    });        
  });

  describe("Account not found exceptions", async() => {
    it("Should not get current balance if account not found", async() => {
      // Assemble
      // Act
      const getPromise = ledger.getCurrentBalance(SOME_EQUITY);
      // Assert
      await expectRevert(getPromise, "not found");
    });

    it("Should not get ledger entry if account not found", async() => {
      // Assemble
      // Act
      const getPromise = ledger.getLedgerEntry(SOME_EQUITY, 0);
      // Assert
      await expectRevert(getPromise, "not found");
    });    
  });

  describe("Query history", async() => {
    it.skip("Placeholder for running balance history tests", async() => {
    });
  });
});
