import { FlareNetworkGeneralLedgerContract, FlareNetworkGeneralLedgerInstance, FtsoRewardManagerAccountingContract, FtsoRewardManagerAccountingInstance } from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";
const { expectRevert } = require('@openzeppelin/test-helpers');
const { constants } = require('@openzeppelin/test-helpers');
const Ledger = artifacts.require("FlareNetworkGeneralLedger") as FlareNetworkGeneralLedgerContract;
const FtsoRewardManagerAccounting = artifacts.require("FtsoRewardManagerAccounting") as FtsoRewardManagerAccountingContract;
const getTestFile = require('../../utils/constants').getTestFile;

const ERR_NOT_POSTER = "not poster";
const ERR_GOVERNANCE_ZERO = "governance zero"
const ERR_NOT_ADMIN = "sender must be an admin to grant"


contract(`FtsoRewardManagerAccounting.sol; ${getTestFile(__filename)}; Ftso reward manager accounting unit tests`, async accounts => {

  let ledger: FlareNetworkGeneralLedgerInstance;
  let rewardManagerAccounting: FtsoRewardManagerAccountingInstance

  beforeEach(async () => {
    ledger = await Ledger.new(accounts[0]);
    rewardManagerAccounting = await FtsoRewardManagerAccounting.new(accounts[0], ledger.address);
  });

  describe("initialization", async () => {
    it("Should ledger not be zero", async () => {
      await expectRevert(FtsoRewardManagerAccounting.new(accounts[0], constants.ZERO_ADDRESS), "gl zero")
    });
    it("Should governance not be zero", async () => {
      await expectRevert(FtsoRewardManagerAccounting.new(constants.ZERO_ADDRESS, ledger.address), ERR_GOVERNANCE_ZERO);
    });
  })

  describe("access control", async () => {
    it("Should test access control on posting methods", async () => {
      await rewardManagerAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      await expectRevert(rewardManagerAccounting.receiveSupply(1000), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsEarned(1000), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsExpired(1000), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsClaimed(1000), ERR_NOT_POSTER);

      // contract not poster
      await expectRevert(rewardManagerAccounting.receiveSupply(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsEarned(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsExpired(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsClaimed(1000, { from: accounts[1] }), ERR_NOT_POSTER);
      await ledger.grantRole(await ledger.POSTER_ROLE(), rewardManagerAccounting.address);

      await expectRevert(rewardManagerAccounting.receiveSupply(1000), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsEarned(1000), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsExpired(1000), ERR_NOT_POSTER);
      await expectRevert(rewardManagerAccounting.rewardsClaimed(1000), ERR_NOT_POSTER);

      let res = await rewardManagerAccounting.receiveSupply(2000, { from: accounts[1] });
      assert(res?.receipt?.status);
      res = await rewardManagerAccounting.rewardsEarned(2000, { from: accounts[1] });
      assert(res?.receipt?.status);
      res = await rewardManagerAccounting.rewardsClaimed(1000, { from: accounts[1] });
      assert(res?.receipt?.status);
      res = await rewardManagerAccounting.rewardsExpired(500, { from: accounts[1] });
      assert(res?.receipt?.status);
    });
    it("Should non admin not be able to grant role", async () => {
      await expectRevert(rewardManagerAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1], { from: accounts[1] }), ERR_NOT_ADMIN);
    });

  });

  describe("functionality", async () => {
    it("Should correctly run receiveSupply", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), rewardManagerAccounting.address);
      await rewardManagerAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_WITHDRAWN)).toNumber(), 0);
      await rewardManagerAccounting.receiveSupply(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_WITHDRAWN)).toNumber(), -1000);
    });
    it("Should correctly run rewardsEarned", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), rewardManagerAccounting.address);
      await rewardManagerAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY)).toNumber(), 0);
      await rewardManagerAccounting.rewardsEarned(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY)).toNumber(), -1000);
    });
    it("Should correctly run rewardsExpired", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), rewardManagerAccounting.address);
      await rewardManagerAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED)).toNumber(), 0);
      await rewardManagerAccounting.rewardsExpired(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED   )).toNumber(), -1000);
    });
    it("Should correctly run rewardsClaimed", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), rewardManagerAccounting.address);
      await rewardManagerAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_CLAIMED)).toNumber(), 0);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED)).toNumber(), 0);
      await rewardManagerAccounting.rewardsClaimed(1000, { from: accounts[1] });
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_CLAIMED)).toNumber(), 1000);
      assert.equal((await ledger.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED)).toNumber(), -1000);
    });
  })

  describe("balances", async () => {
    it("Should get correct reward manager balance", async () => {
      await ledger.grantRole(await ledger.POSTER_ROLE(), rewardManagerAccounting.address);
      await rewardManagerAccounting.grantRole(await ledger.POSTER_ROLE(), accounts[1]);
      assert.equal((await rewardManagerAccounting.getRewardManagerBalance()).toNumber(), 0);
      await rewardManagerAccounting.receiveSupply(2000, { from: accounts[1] });
      assert.equal((await rewardManagerAccounting.getRewardManagerBalance()).toNumber(), 2000);
      await rewardManagerAccounting.rewardsEarned(1000, { from: accounts[1] });
      assert.equal((await rewardManagerAccounting.getRewardManagerBalance()).toNumber(), 2000);
      await rewardManagerAccounting.rewardsClaimed(500, { from: accounts[1] });
      assert.equal((await rewardManagerAccounting.getRewardManagerBalance()).toNumber(), 1500);
      await rewardManagerAccounting.rewardsExpired(500, { from: accounts[1] });
      assert.equal((await rewardManagerAccounting.getRewardManagerBalance()).toNumber(), 1500);
      // TODO: test for case, when something is credited to FTSO_REWARD_MANAGER_SELF_DESTRUCT_PROCEEDS
    });
  })
});
