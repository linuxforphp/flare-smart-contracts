import { FlareNetworkGeneralLedgerContract, FlareNetworkGeneralLedgerInstance } from "../../../typechain-truffle";

const getTestFile = require('../../utils/constants').getTestFile;

const Ledger = artifacts.require("FlareNetworkGeneralLedger") as FlareNetworkGeneralLedgerContract;

contract(`FlareNetworkGeneralLedger.sol; ${getTestFile(__filename)}; Flare network GL unit tests`, async accounts => {
  let ledger: FlareNetworkGeneralLedgerInstance;

  beforeEach(async() => {
    ledger = await Ledger.new(accounts[0]);
  });

  describe("Instantiate", async() => {
    it("Should have a default chart of account set", async() => {
      // Assemble
      // Act
      const accountNames = await ledger.getAccountNames();
      // Assert
      assert(accountNames.length == 17);
    });
  });

  it.skip("TODO: Check that accounts are the types as intended", async() => {
  });

  describe("access control", async() => {
    it.skip("Should test access control on posting methods", async() => {
    });
    it.skip("Should test zero address constructor edits", async() => {
    });
  });
});
