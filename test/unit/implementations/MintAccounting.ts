
import { FlareNetworkGeneralLedgerContract, FlareNetworkGeneralLedgerInstance, FtsoInflationAccountingInstance, MintAccountingContract, MintAccountingInstance } from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";
const { expectRevert } = require('@openzeppelin/test-helpers');
const { constants } = require('@openzeppelin/test-helpers');
const Ledger = artifacts.require("FlareNetworkGeneralLedger") as FlareNetworkGeneralLedgerContract;
const MintAccounting = artifacts.require("MintAccounting") as MintAccountingContract;
const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting");

const getTestFile = require('../../utils/constants').getTestFile;

const ERR_NOT_POSTER = "not poster";
const ERR_GOVERNANCE_ZERO = "governance zero"
const ERR_NOT_ADMIN = "sender must be an admin to grant"


contract(`MintAccounting.sol; Mint accounting unit tests`, async accounts => {

  let ledger: FlareNetworkGeneralLedgerInstance;
  let mintAccounting: MintAccountingInstance;
  let ftsoInflationAccounting: FtsoInflationAccountingInstance;

  beforeEach(async () => {
    ledger = await Ledger.new(accounts[0]);
    mintAccounting = await MintAccounting.new(accounts[0], ledger.address);
    ftsoInflationAccounting = await FtsoInflationAccounting.new(accounts[0], ledger.address);
  });

  describe("initialization", async () => {
    it("Should ledger not be zero", async () => {
      await expectRevert(MintAccounting.new(accounts[0], constants.ZERO_ADDRESS), "gl zero")
    });
    it("Should governance not be zero", async () => {
      await expectRevert(MintAccounting.new(constants.ZERO_ADDRESS, ledger.address), ERR_GOVERNANCE_ZERO);
    });
  })

  describe("access control", async () => {
    it("Should test access control on posting methods", async () => {
      await mintAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      await expectRevert(mintAccounting.requestMinting(1000), ERR_NOT_POSTER);
      await expectRevert(mintAccounting.receiveMinting(1000), ERR_NOT_POSTER);
      await expectRevert(mintAccounting.receiveSelfDestructProceeds(1000), ERR_NOT_POSTER);

      // contract not poster
      await expectRevert(mintAccounting.requestMinting(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await expectRevert(mintAccounting.receiveMinting(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await expectRevert(mintAccounting.receiveSelfDestructProceeds(1000, { from: accounts[1] }), ERR_NOT_POSTER);

      await ledger.grantRole(await ledger.POSTER_ROLE(), mintAccounting.address);

      await expectRevert(mintAccounting.requestMinting(1000), ERR_NOT_POSTER);
      await expectRevert(mintAccounting.receiveMinting(1000), ERR_NOT_POSTER);
      await expectRevert(mintAccounting.receiveSelfDestructProceeds(1000), ERR_NOT_POSTER);

      let res = await mintAccounting.requestMinting(1000, { from: accounts[1] });
      assert(res?.receipt?.status);
      res = await mintAccounting.receiveMinting(1000, { from: accounts[1] });
      assert(res?.receipt?.status);
      res = await mintAccounting.receiveSelfDestructProceeds(1000, { from: accounts[1] });
      assert(res?.receipt?.status);
    });
    it("Should non admin not be able to grant role", async () => {
      await expectRevert(mintAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1], { from: accounts[1] }), ERR_NOT_ADMIN);
    });

  });


  describe("functionality", async () => {
    it("Should correctly run requestMinting", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), mintAccounting.address);
      await mintAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED)).toNumber(), 0);
      await mintAccounting.requestMinting(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED)).toNumber(), -1000);
    });
    it("Should correctly run receiveMinting", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), mintAccounting.address);
      await mintAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED)).toNumber(), 0);
      await mintAccounting.receiveMinting(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED)).toNumber(), -1000);
    });
    it("Should correctly run receiveSelfDestructProceeds", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), mintAccounting.address);
      await mintAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.GENESIS)).toNumber(), 0);
      await mintAccounting.receiveSelfDestructProceeds(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.GENESIS)).toNumber(), -1000);
    });

  })

  describe("balances", async () => {
    it("Should get correct mint accounting balances", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), mintAccounting.address);
      await ledger.grantRole(await ledger.POSTER_ROLE(), ftsoInflationAccounting.address);
      await mintAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      ftsoInflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      await ftsoInflationAccounting.authorizeMinting(1000, {from: accounts[1]});
      let bn1 = await web3.eth.getBlockNumber();
      assert.equal((await mintAccounting.getKeeperBalance()).toNumber(), 0);
      assert.equal((await mintAccounting.getInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getUnmintedInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getMintedInflationBalance()).toNumber(), 0);
      assert.equal((await mintAccounting.getMintingRequested()).toNumber(), 0);

      await mintAccounting.requestMinting(1000, { from: accounts[1] });
      let bn2 = await web3.eth.getBlockNumber();
      assert.equal((await mintAccounting.getKeeperBalance()).toNumber(), 0);
      assert.equal((await mintAccounting.getInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getUnmintedInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getMintedInflationBalance()).toNumber(), 0);
      assert.equal((await mintAccounting.getMintingRequested()).toNumber(), 1000);

      await mintAccounting.receiveMinting(1000, { from: accounts[1] });
      let bn3 = await web3.eth.getBlockNumber();
      assert.equal((await mintAccounting.getKeeperBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getUnmintedInflationBalance()).toNumber(), 0);
      assert.equal((await mintAccounting.getMintedInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getMintingRequested()).toNumber(), 0);

      await mintAccounting.receiveSelfDestructProceeds(500, { from: accounts[1] });
      let bn4 = await web3.eth.getBlockNumber();
      assert.equal((await mintAccounting.getKeeperBalance()).toNumber(), 1500);
      assert.equal((await mintAccounting.getInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getUnmintedInflationBalance()).toNumber(), 0);
      assert.equal((await mintAccounting.getMintedInflationBalance()).toNumber(), 1000);
      assert.equal((await mintAccounting.getMintingRequested()).toNumber(), 0);
    });
  })

});
