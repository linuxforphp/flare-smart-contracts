import { FlareNetworkGeneralLedgerInstance, 
  FtsoRewardManagerAccountingInstance } from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";

const { constants, expectRevert } = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const FlareNetworkGeneralLedger = artifacts.require("FlareNetworkGeneralLedger");
const FtsoRewardManagerAccounting = artifacts.require("FtsoRewardManagerAccounting");

contract(`FtsoRewardManagerAccounting.sol; ${getTestFile(__filename)}; Ftso reward manager accounting integration tests`, async accounts => {
  // contains a fresh contract for each test
  let gl: FlareNetworkGeneralLedgerInstance;
  let ftsoRewardManagerAccounting: FtsoRewardManagerAccountingInstance;

  beforeEach(async() => {
    gl = await FlareNetworkGeneralLedger.new(accounts[0]);
    await gl.grantRole(await gl.POSTER_ROLE(), accounts[0]);
    ftsoRewardManagerAccounting = await FtsoRewardManagerAccounting.new(accounts[0], gl.address);
    await ftsoRewardManagerAccounting.grantRole(await ftsoRewardManagerAccounting.POSTER_ROLE(), accounts[0]);
    gl.grantRole(await gl.POSTER_ROLE(), ftsoRewardManagerAccounting.address);
  });

  describe("post", async() => {
    it("Should post received supply of FLR for rewarding", async() => {
      // Assemble
      // Act
      await ftsoRewardManagerAccounting.receiveSupply(1000);
      // Assert
      const assetBalance = await gl.assetBalance();
      const supply = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY);
      const withdrawn = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_WITHDRAWN);
      // MintingWithdrawn is an asset-contra account. This transaction should net to zero on Asset side of ledger.
      assert.equal(assetBalance.toNumber(), 0)
      assert.equal(supply.toNumber(), 1000);
      assert.equal(withdrawn.toNumber(), -1000);
    });

    it("Should post earned rewards", async() => {
      // Assemble
      await ftsoRewardManagerAccounting.receiveSupply(1000);
      // Act
      await ftsoRewardManagerAccounting.rewardsEarned(50);
      // Assert
      const supply = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY);
      const earned = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED);
      assert.equal(supply.toNumber(), 950);
      assert.equal(earned.toNumber(), 50);
    });    

    it("Should post claimed rewards", async() => {
      // Assemble
      await ftsoRewardManagerAccounting.receiveSupply(1000);
      await ftsoRewardManagerAccounting.rewardsEarned(50);
      // Act
      await ftsoRewardManagerAccounting.rewardsClaimed(10);
      // Assert
      const supply = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY);
      const earned = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED);
      const claimed = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_CLAIMED);
      assert.equal(supply.toNumber(), 950);
      assert.equal(earned.toNumber(), 40);
      assert.equal(claimed.toNumber(), 10);
    });
  });

  describe("calculate", async() => {
    it("Should calculate ftso reward manager balance", async() => {
      // Assemble
      await ftsoRewardManagerAccounting.receiveSupply(1000);
      await ftsoRewardManagerAccounting.rewardsEarned(50);
      await ftsoRewardManagerAccounting.rewardsClaimed(10);
      // Act
      const rewardManagerBalance: BN = await ftsoRewardManagerAccounting.getRewardManagerBalance() as any;
      // Assert
      assert.equal(rewardManagerBalance.toNumber(), 990);
    });
  });
});