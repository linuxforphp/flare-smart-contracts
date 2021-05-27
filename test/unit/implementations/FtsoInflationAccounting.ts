import { FlareNetworkGeneralLedgerContract, FlareNetworkGeneralLedgerInstance, FtsoInflationAccountingContract, FtsoInflationAccountingInstance } from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";
const { expectRevert } = require('@openzeppelin/test-helpers');
const { constants } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const Ledger = artifacts.require("FlareNetworkGeneralLedger") as FlareNetworkGeneralLedgerContract;
const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting") as FtsoInflationAccountingContract;

const ERR_NOT_POSTER = "not poster";
const ERR_GOVERNANCE_ZERO = "governance zero"
const ERR_NOT_ADMIN = "sender must be an admin to grant"

contract(`FtsoInflationAccounting.sol; ${getTestFile(__filename)}; Ftso inflation reward accounting unit tests`, async accounts => {

  let ledger: FlareNetworkGeneralLedgerInstance;
  let inflationAccounting: FtsoInflationAccountingInstance;

  beforeEach(async () => {
    ledger = await Ledger.new(accounts[0]);
    inflationAccounting = await FtsoInflationAccounting.new(accounts[0], ledger.address);
  });

  describe("initialization", async () => {
    it("Should ledger not be zero", async () => {
      await expectRevert(FtsoInflationAccounting.new(accounts[0], constants.ZERO_ADDRESS), "gl zero")
    });
    it("Should governance not be zero", async () => {
      await expectRevert(FtsoInflationAccounting.new(constants.ZERO_ADDRESS, ledger.address), ERR_GOVERNANCE_ZERO);
    });
  })


  describe("access control", async () => {
    it("Should test access control on posting methods", async () => {
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      await expectRevert(inflationAccounting.inflateForAnnum(1000), ERR_NOT_POSTER);
      await expectRevert(inflationAccounting.authorizeMinting(1000), ERR_NOT_POSTER);
      await expectRevert(inflationAccounting.receiveMinting(1000), ERR_NOT_POSTER);

      // contract not poster
      await expectRevert(inflationAccounting.inflateForAnnum(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await expectRevert(inflationAccounting.authorizeMinting(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await expectRevert(inflationAccounting.receiveMinting(1000, { from: accounts[1] }), ERR_NOT_POSTER);

      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);

      await expectRevert(inflationAccounting.inflateForAnnum(1000), ERR_NOT_POSTER);
      await expectRevert(inflationAccounting.authorizeMinting(1000), ERR_NOT_POSTER);
      await expectRevert(inflationAccounting.receiveMinting(1000), ERR_NOT_POSTER);

      let res = await inflationAccounting.inflateForAnnum(1000, { from: accounts[1] });
      assert(res?.receipt?.status);
      res = await inflationAccounting.authorizeMinting(1000, { from: accounts[1] });
      assert(res?.receipt?.status);
      res = await inflationAccounting.receiveMinting(1000, { from: accounts[1] });
      assert(res?.receipt?.status);
    });
    it("Should non admin not be able to grant role", async () => {
      await expectRevert(inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1], { from: accounts[1] }), ERR_NOT_ADMIN);
    });

  });

  describe("functionality", async () => {
    it("Should correctly run inflateForAnnum", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_EXPECTED)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MINTING_UNAUTHORIZED)).toNumber(), 0);
      await inflationAccounting.inflateForAnnum(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_EXPECTED)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MINTING_UNAUTHORIZED)).toNumber(), -1000);
    });
    it("Should correctly run authorizeMinting", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE)).toNumber(), 0);
      await inflationAccounting.authorizeMinting(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE)).toNumber(), 1000); // liability
    });
    it("Should correctly run receiveMinting", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE)).toNumber(), 0);
      await inflationAccounting.authorizeMinting(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE)).toNumber(), 1000); // liability
      await inflationAccounting.receiveMinting(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE)).toNumber(), 0); // liability
    });
    it("Should not receiveMinting if not authorized", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      await expectRevert(inflationAccounting.receiveMinting(1000, { from: accounts[1] }), "SafeMath: subtraction overflow");
    });

  })

  describe("balances", async () => {
    it("Should get correct minted inflation balance", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await inflationAccounting.getMintedInflationBalance()).toNumber(), 0);
      await inflationAccounting.authorizeMinting(1000, { from: accounts[1] });
      assert.equal((await inflationAccounting.getMintedInflationBalance()).toNumber(), 0);
      await inflationAccounting.receiveMinting(1000, { from: accounts[1] });
      assert.equal((await inflationAccounting.getMintedInflationBalance()).toNumber(), 1000);
    });
    it("Should get correct inflation balance", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await inflationAccounting.getInflationBalance()).toNumber(), 0);
      await inflationAccounting.authorizeMinting(1000, { from: accounts[1] });
      assert.equal((await inflationAccounting.getInflationBalance()).toNumber(), 1000);
      await inflationAccounting.receiveMinting(1000, { from: accounts[1] });
      assert.equal((await inflationAccounting.getInflationBalance()).toNumber(), 1000);
      await inflationAccounting.authorizeMinting(500, { from: accounts[1] });
      assert.equal((await inflationAccounting.getInflationBalance()).toNumber(), 1500);
      await inflationAccounting.receiveMinting(250, { from: accounts[1] });
      assert.equal((await inflationAccounting.getInflationBalance()).toNumber(), 1500);
      await inflationAccounting.receiveMinting(250, { from: accounts[1] });
      assert.equal((await inflationAccounting.getInflationBalance()).toNumber(), 1500);
    });
    it("Should get correct unminted inflation balance", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), inflationAccounting.address);
      await inflationAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await inflationAccounting.getUnmintedInflationBalance()).toNumber(), 0);
      await inflationAccounting.authorizeMinting(1000, { from: accounts[1] });
      assert.equal((await inflationAccounting.getUnmintedInflationBalance()).toNumber(), 1000);
      await inflationAccounting.receiveMinting(1000, { from: accounts[1] });
      assert.equal((await inflationAccounting.getUnmintedInflationBalance()).toNumber(), 0);
      await inflationAccounting.authorizeMinting(500, { from: accounts[1] });
      assert.equal((await inflationAccounting.getUnmintedInflationBalance()).toNumber(), 500);
      await inflationAccounting.receiveMinting(250, { from: accounts[1] });
      assert.equal((await inflationAccounting.getUnmintedInflationBalance()).toNumber(), 250);
      await inflationAccounting.receiveMinting(250, { from: accounts[1] });
      assert.equal((await inflationAccounting.getUnmintedInflationBalance()).toNumber(), 0);

    });

  })


});
