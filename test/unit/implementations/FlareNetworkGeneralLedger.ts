import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";
import { FlareNetworkGeneralLedgerContract, FlareNetworkGeneralLedgerInstance } from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";
const { expectRevert } = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const Ledger = artifacts.require("FlareNetworkGeneralLedger") as FlareNetworkGeneralLedgerContract;

const ERR_NOT_POSTER = "not poster";
const ERR_NOT_ADMIN = "sender must be an admin to grant"
const ERR_NOT_MAINTAINER = "not maintainer"

const namesFromConfig = [
  FlareNetworkChartOfAccounts.GENESIS,
  FlareNetworkChartOfAccounts.BURNED,
  FlareNetworkChartOfAccounts.MINTING_AUTHORIZED,
  FlareNetworkChartOfAccounts.MINTING_REQUESTED,
  FlareNetworkChartOfAccounts.MINTED,

  FlareNetworkChartOfAccounts.MINTING_WITHDRAWN,
  FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY,
  FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED,
  FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_CLAIMED,
  FlareNetworkChartOfAccounts.FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS,

  FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SELF_DESTRUCT_PROCEEDS,
  FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_EXPECTED,
  FlareNetworkChartOfAccounts.FTSO_REWARD_MINTING_UNAUTHORIZED,
  FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE,
  FlareNetworkChartOfAccounts.GENESIS_TOKEN,

  FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN,
  FlareNetworkChartOfAccounts.BURNED_TOKEN
]

contract(`FlareNetworkGeneralLedger.sol; ${ getTestFile(__filename) }; Flare network GL unit tests`, async accounts => {
  let ledger: FlareNetworkGeneralLedgerInstance;

  beforeEach(async () => {
    ledger = await Ledger.new(accounts[0]);
  });

  describe("Instantiate", async () => {
    it("Should have a default chart of account set", async () => {
      // Assemble
      // Act
      const accountNames = await ledger.getAccountNames();
      // Assert
      assert(accountNames.length == namesFromConfig.length);
    });
    it("Check that accounts are the types as intended", async () => {
      let names = await ledger.getAccountNames();
      for (let name of names) {
        assert(namesFromConfig.indexOf(name) >= 0);
      }
    });
  });

  describe("access control", async () => {
    it("Should test access control on posting methods", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      const journalEntries = [];
      journalEntries[0] = { accountName: FlareNetworkChartOfAccounts.GENESIS, debit: "1000000000", credit: 0 };
      journalEntries[1] = { accountName: FlareNetworkChartOfAccounts.GENESIS_TOKEN, debit: 0, credit: "1000000000" };
      await expectRevert(ledger.post(journalEntries, { from: accounts[2] }), ERR_NOT_POSTER);
      let res = await ledger.post(journalEntries, { from: accounts[1] });
      assert(res?.receipt?.status);
    });
    it("Should non admin not be able to grant role", async () => {
      await expectRevert(ledger.grantRole(await ledger.POSTER_ROLE(), accounts[1], { from: accounts[1] }), ERR_NOT_ADMIN);
    });
    it("Should fail adding account if not maintainer", async () => {
      await expectRevert(ledger.addAccount(
        {
          name: keccak256(toUtf8Bytes("some_name")),
          accountType: 0
        },
        { from: accounts[1] }
      ), ERR_NOT_MAINTAINER);
    })

  });

  describe("adding accounts", async () => {
    it("Should add account if maintainer", async () => {
      let name = keccak256(toUtf8Bytes("some_name"));
      await ledger.addAccount(
        {
          name,
          accountType: 0
        },
        { from: accounts[0] }
      );
      const accountNames = await ledger.getAccountNames();
      assert(accountNames[accountNames.length - 1] == name);
    });
  })

});
