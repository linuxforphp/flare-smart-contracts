import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { AccountMockContract, AccountMockInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";
import { AccountType } from "../../utils/Accounting"

const getTestFile = require('../../utils/constants').getTestFile;

const Account = artifacts.require("AccountMock") as AccountMockContract;

contract(`AccountMock.sol; ${getTestFile(__filename)}; Account library unit tests`, async accounts => {
  beforeEach(async () => {
  });

  describe("Asset accounts", async() => {
    let assetAccount: AccountMockInstance;

    beforeEach(async() => {
      assetAccount = await Account.new(keccak256(toUtf8Bytes("AssetAccount")), AccountType.ASSET);
    });

    it("Should debit", async() => {
      // Assemble
      // Act
      await assetAccount.debit(1000);
      // Assert
      const {debit} = await assetAccount.ledgerEntries(0);
      const currentBalance = await assetAccount.currentBalance();
      assert.equal(debit, toBN(1000));
      assert.equal(currentBalance.toNumber(), 1000);
    });

    it("Should credit", async() => {
      // Assemble
      // Act
      await assetAccount.credit(1000);
      // Assert
      const {credit} = await assetAccount.ledgerEntries(0);
      const currentBalance = await assetAccount.currentBalance();
      assert.equal(credit, toBN(1000));
      assert.equal(currentBalance.toNumber(), -1000);
    });

    it("Should net debits and credits", async() => {
      // Assemble
      await assetAccount.debit(1000);
      await assetAccount.credit(500);
      // Act
      const currentBalance = await assetAccount.currentBalance();
      // Assert
      assert.equal(currentBalance.toNumber(), 500);
    });
  });

  describe("Liability accounts", async() => {
    let liabilityAccount: AccountMockInstance;

    beforeEach(async() => {
      liabilityAccount = await Account.new(keccak256(toUtf8Bytes("LiabilityAccount")), AccountType.LIABILITY);
    });

    it("Should debit", async() => {
      // Assemble
      // Act
      await liabilityAccount.debit(1000);
      // Assert
      const {debit} = await liabilityAccount.ledgerEntries(0);
      const currentBalance = await liabilityAccount.currentBalance();
      assert.equal(debit, toBN(1000));
      assert.equal(currentBalance.toNumber(), -1000);
    });

    it("Should credit", async() => {
      // Assemble
      // Act
      await liabilityAccount.credit(1000);
      // Assert
      const {credit} = await liabilityAccount.ledgerEntries(0);
      const currentBalance = await liabilityAccount.currentBalance();
      assert.equal(credit, toBN(1000));
      assert.equal(currentBalance.toNumber(), 1000);
    });

    it("Should net debits and credits", async() => {
      // Assemble
      await liabilityAccount.credit(1000);
      await liabilityAccount.debit(500);
      // Act
      const currentBalance = await liabilityAccount.currentBalance();
      // Assert
      assert.equal(currentBalance.toNumber(), 500);
    });
  });

  describe("Equity accounts", async() => {
    let equityAccount: AccountMockInstance;

    beforeEach(async() => {
      equityAccount = await Account.new(keccak256(toUtf8Bytes("EquityAccount")), AccountType.EQUITY);
    });

    it("Should debit", async() => {
      // Assemble
      // Act
      await equityAccount.debit(1000);
      // Assert
      const {debit} = await equityAccount.ledgerEntries(0);
      const currentBalance = await equityAccount.currentBalance();
      assert.equal(debit, toBN(1000));
      assert.equal(currentBalance.toNumber(), -1000);
    });

    it("Should credit", async() => {
      // Assemble
      // Act
      await equityAccount.credit(1000);
      // Assert
      const {credit} = await equityAccount.ledgerEntries(0);
      const currentBalance = await equityAccount.currentBalance();
      assert.equal(credit, toBN(1000));
      assert.equal(currentBalance.toNumber(), 1000);
    });

    it("Should net debits and credits", async() => {
      // Assemble
      await equityAccount.credit(1000);
      await equityAccount.debit(500);
      // Act
      const currentBalance = await equityAccount.currentBalance();
      // Assert
      assert.equal(currentBalance.toNumber(), 500);
    });
  });

  describe("Running balances", async() => {
    it.skip("TODO: Should test running balances by block", async() => {
    });
  });

  describe("Ledger entries", async() => {
    it.skip("TODO: Should store ledger entries on block occurred", async() => {
    });
  });
});