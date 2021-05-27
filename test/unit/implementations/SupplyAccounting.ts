
import { FlareNetworkGeneralLedgerContract, FlareNetworkGeneralLedgerInstance, FtsoInflationAccountingContract, FtsoInflationAccountingInstance, SupplyAccountingContract, SupplyAccountingInstance } from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";
const { expectRevert } = require('@openzeppelin/test-helpers');
const { constants } = require('@openzeppelin/test-helpers');
const Ledger = artifacts.require("FlareNetworkGeneralLedger") as FlareNetworkGeneralLedgerContract;
const SupplyAccounting = artifacts.require("SupplyAccounting") as SupplyAccountingContract;
const getTestFile = require('../../utils/constants').getTestFile;

const ERR_NOT_POSTER = "not poster";
const ERR_GOVERNANCE_ZERO = "governance zero"
const ERR_NOT_ADMIN = "sender must be an admin to grant"


contract(`SupplyAccounting.sol; ${getTestFile(__filename)}; Supply accounting unit tests`, async accounts => {

  let ledger: FlareNetworkGeneralLedgerInstance;
  let supplyAccounting: SupplyAccountingInstance

  beforeEach(async () => {
    ledger = await Ledger.new(accounts[0]);
    supplyAccounting = await SupplyAccounting.new(ledger.address);
  });

  describe("initialization", async () => {
    it("Should ledger not be zero", async () => {
      await expectRevert(SupplyAccounting.new(constants.ZERO_ADDRESS), "gl zero")
    });
  })

  describe("balances", async () => {
    it("Should get correct mint accounting balances", async () => {
      // TODO: Do some account posts and check balances
      assert.equal((await supplyAccounting.getInflatableSupplyBalance()).toNumber(), 0);
      assert.equal((await supplyAccounting.getOnChainSupplyBalance()).toNumber(), 0);
      assert.equal((await supplyAccounting.getUndistributedFtsoInflationBalance()).toNumber(), 0);
      assert.equal((await supplyAccounting.getCirculatingSupplyBalance()).toNumber(), 0);
    });
  })
  
});
