import {
  FlareNetworkGeneralLedgerInstance, 
  MintAccountingInstance} from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";

const { constants, expectRevert } = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const FlareNetworkGeneralLedger = artifacts.require("FlareNetworkGeneralLedger");
const MintAccounting = artifacts.require("MintAccounting");

contract(`MintAccounting.sol; ${getTestFile(__filename)}; Mint accounting integration tests`, async accounts => {
  // contains a fresh contract for each test
  let gl: FlareNetworkGeneralLedgerInstance;
  let mintAccounting: MintAccountingInstance;

  beforeEach(async() => {
    gl = await FlareNetworkGeneralLedger.new(accounts[0]);
    await gl.grantRole(await gl.POSTER_ROLE(), accounts[0])
    mintAccounting = await MintAccounting.new(accounts[0], gl.address);
    await mintAccounting.grantRole(await mintAccounting.POSTER_ROLE(), accounts[0]);
    gl.grantRole(await gl.POSTER_ROLE(), mintAccounting.address);
  });

  describe("post", async() => {
    it("Should post minting requested", async() => {
      // Assemble
      // Authorize some minting
      const journalEntries = [];
      journalEntries[0] = {accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, debit: 1000, credit: 0};
      journalEntries[1] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, debit: 0, credit: 1000};
      await gl.post(journalEntries);

      // Act
      await mintAccounting.requestMinting(100);

      // Assert
      const mintingAuthorized = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED);
      const mintingRequested = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED);
      const minted = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED);
      assert.equal(mintingAuthorized.toNumber(), 900);
      assert.equal(mintingRequested.toNumber(), 100);
      assert.equal(minted.toNumber(), 0);
    });

    it("Should post minting received", async() => {
      // Assemble
      // Authorize and request some minting
      const journalEntries = [];
      journalEntries[0] = {accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, debit: 1000, credit: 100};
      journalEntries[1] = {accountName: FlareNetworkChartOfAccounts.MINTING_REQUESTED, debit: 100, credit: 0};
      journalEntries[2] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, debit: 0, credit: 1000};
      await gl.post(journalEntries);

      // Act
      await mintAccounting.receiveMinting(100);

      // Assert
      const mintingAuthorized = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED);
      const mintingRequested = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED);
      const minted = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED);
      assert.equal(mintingAuthorized.toNumber(), 900);
      assert.equal(mintingRequested.toNumber(), 0);
      assert.equal(minted.toNumber(), 100);
    });
  });

  describe("calculate", async() => {
    it("Should calculate keeper balance", async() => {
      // Assemble
      // Record some minted Flare from the validator
      const journalEntries = [];
      journalEntries[0] = {accountName: FlareNetworkChartOfAccounts.MINTED, debit: 1000, credit: 0};
      journalEntries[1] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN, debit: 0, credit: 1000};
      // Move some minted Flare to the ftso reward manager (from the keeper accounts)
      journalEntries[2] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY, debit: 50, credit: 0};
      journalEntries[3] = {accountName: FlareNetworkChartOfAccounts.MINTING_WITHDRAWN, debit: 0, credit: 50};
      await gl.post(journalEntries);
  
      // Act
      const keeperBalance: BN = await mintAccounting.getKeeperBalance() as any;

      // Assert
      assert.equal(keeperBalance.toNumber(), 950);
    });

    it("Should calculate unminted but authorized inflation balance across all inflation types", async() => {
      // Authorize some minting
      const journalEntries = [];
      journalEntries[0] = {accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, debit: 1000, credit: 100};
      journalEntries[1] = {accountName: FlareNetworkChartOfAccounts.MINTING_REQUESTED, debit: 100, credit: 0};
      journalEntries[2] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, debit: 0, credit: 1000};
      await gl.post(journalEntries);

      // Act
      const unmintedBalance: BN = await mintAccounting.getUnmintedInflationBalance() as any;

      // Assert
      assert.equal(unmintedBalance.toNumber(), 1000);
    });

    it("Should calculate minted, unwithdrawn inflation balance across all inflation types", async() => {
      const journalEntries = [];
      journalEntries[0] = {accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, debit: 950, credit: 0};
      journalEntries[1] = {accountName: FlareNetworkChartOfAccounts.MINTED, debit: 50, credit: 0};
      journalEntries[2] = {accountName: FlareNetworkChartOfAccounts.MINTING_WITHDRAWN, debit: 0, credit: 10};
      journalEntries[3] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, debit: 0, credit: 950};
      journalEntries[4] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN, debit: 0, credit: 50};
      journalEntries[5] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY, debit: 10, credit: 0};
      await gl.post(journalEntries);

      // Act
      const mintedBalance: BN = await mintAccounting.getMintedInflationBalance() as any;

      // Assert
      assert.equal(mintedBalance.toNumber(), 50);
    });

    it("Should calculate minted and unminted inflation balance across all inflation types", async() => {
      const journalEntries = [];
      journalEntries[0] = {accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, debit: 950, credit: 60};
      journalEntries[1] = {accountName: FlareNetworkChartOfAccounts.MINTING_REQUESTED, debit: 60, credit: 0};
      journalEntries[2] = {accountName: FlareNetworkChartOfAccounts.MINTED, debit: 50, credit: 0};
      journalEntries[3] = {accountName: FlareNetworkChartOfAccounts.MINTING_WITHDRAWN, debit: 0, credit: 10};
      journalEntries[4] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, debit: 0, credit: 950};
      journalEntries[5] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN, debit: 0, credit: 50};
      journalEntries[6] = {accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY, debit: 10, credit: 0};
      await gl.post(journalEntries);

      // Act
      const inflationBalance: BN = await mintAccounting.getInflationBalance() as any;

      // Assert
      assert.equal(inflationBalance.toNumber(), 1000);
    });
  });
});
