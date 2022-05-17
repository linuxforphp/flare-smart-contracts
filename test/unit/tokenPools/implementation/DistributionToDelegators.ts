import { DistributionToDelegatorsInstance, DistributionTreasuryInstance, MockContractInstance, SupplyInstance, WNatInstance } from "../../../../typechain-truffle";
import { encodeContractNames, toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;
const { sumGas, calcGasCost } = require('../../../utils/eth');
import { expectRevert, expectEvent, time, constants } from '@openzeppelin/test-helpers';
import { GOVERNANCE_GENESIS_ADDRESS, PRICE_SUBMITTER_ADDRESS } from "../../../utils/constants";
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { ethers, network } from "hardhat";
import { Supply__factory } from "../../../../typechain";

const BN = web3.utils.toBN;

const DelegationAccountManager = artifacts.require("DelegationAccountManager");
const DistributionTreasury = artifacts.require("DistributionTreasury");
const DistributionToDelegators = artifacts.require("DistributionToDelegators");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");
const WNat = artifacts.require("WNat");
const Supply = artifacts.require("Supply");

const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ADDRESS_ZERO = "address zero";
const ERR_BALANCE_TOO_LOW = "balance too low";
const ERR_NOT_ZERO = "not zero";
const ERR_IN_THE_PAST = "in the past";
const ERR_OPT_OUT = "already opted out";
const ERR_NOT_OPT_OUT = "not opted out"
const ERR_NOT_STARTED = "not started";
const ERR_ALREADY_FINISHED = "already finished";
const ERR_MONTH_EXPIRED = "month expired";
const ERR_MONTH_NOT_CLAIMABLE = "month not claimable";
const ERR_MONTH_NOT_CLAIMABLE_YET = "month not claimable yet";
const ERR_DELEGATION_ACCOUNT_ZERO = "delegation account zero"

let priceSubmitterMock: MockContractInstance;
let wNatMock: MockContractInstance;
let supply: SupplyInstance;
let delegationAccountManagerMock: MockContractInstance;
let wNatInterface: WNatInstance;
let distributionTreasury: DistributionTreasuryInstance;
let distribution: DistributionToDelegatorsInstance;
let ADDRESS_UPDATER: string;
let INFLATION_ADDRESS: string;

async function bestowClaimableBalance(balance: BN) {
  // Give the distribution contract the native token required to be in balance with entitlements
  // Our subversive attacker will be suiciding some native token into flareDaemon
  const suicidalMock = await SuicidalMock.new(distributionTreasury.address);
  // Give suicidal some native token
  await web3.eth.sendTransaction({ from: GOVERNANCE_GENESIS_ADDRESS, to: suicidalMock.address, value: balance });
  // Attacker dies
  await suicidalMock.die();
  // set distribution contract and claimable amount
  await distributionTreasury.setDistributionContract(distribution.address, balance.divn(35), {from: GOVERNANCE_GENESIS_ADDRESS});
}

// WARNING: using givenMethodReturn instead of givenCalldataReturn may cause problems
async function setMockBalances(startBlockNumber: number, numberOfBlocks: number, addresses: string[], wNatBalances: number[]) {
  const len = addresses.length;
  assert(len == wNatBalances.length, "addresses length does not match wNatBalances length");

  for (let block = startBlockNumber; block < startBlockNumber + numberOfBlocks; block++) {
    let totalSupply = 0;
    for (let i = 0; i < len; i++) {
      const balanceOfAt = wNatInterface.contract.methods.balanceOfAt(addresses[i], block).encodeABI();
      const balanceOfAtReturn = web3.eth.abi.encodeParameter('uint256', wNatBalances[i]);
      await wNatMock.givenCalldataReturn(balanceOfAt, balanceOfAtReturn);
      totalSupply += wNatBalances[i];
    }

    const totalSupplyAt = wNatInterface.contract.methods.totalSupplyAt(block).encodeABI();
    const totalSupplyAtReturn = web3.eth.abi.encodeParameter('uint256', totalSupply);
    await wNatMock.givenCalldataReturn(totalSupplyAt, totalSupplyAtReturn);
  }
}

async function createSomeBlocksAndProceed(now: BN, proceedDays: number) {
  for (let i = 1; i <= proceedDays; i++) {
    for (let j = 0; j < 5; j++) {
      await time.increase(6000);
    }
    await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
    for (let j = 0; j < 5; j++) {
      await time.increase(6000);
    }
    await time.increaseTo(now.addn(i * 86400));
  }
  await time.advanceBlock();
}

contract(`DistributionToDelegators.sol; ${getTestFile(__filename)}; DistributionToDelegators unit tests`, async accounts => {
  const GOVERNANCE_ADDRESS = accounts[10];
  ADDRESS_UPDATER = accounts[16];
  INFLATION_ADDRESS = accounts[17];
  const totalEntitlementWei = toBN(100000);


  beforeEach(async () => {
    wNatInterface = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    priceSubmitterMock = await MockContract.new();
    wNatMock = await MockContract.new();
    supply = await Supply.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, constants.ZERO_ADDRESS, 10000000, 9000000, []);
    delegationAccountManagerMock = await MockContract.new();
    distributionTreasury = await DistributionTreasury.new();
    await distributionTreasury.initialiseFixedAddress();
    distribution = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, priceSubmitterMock.address, distributionTreasury.address, totalEntitlementWei);

    await distribution.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.SUPPLY, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, wNatMock.address, supply.address, delegationAccountManagerMock.address], {from: ADDRESS_UPDATER});

    await supply.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
      [ADDRESS_UPDATER, INFLATION_ADDRESS], {from: ADDRESS_UPDATER});
    
    await supply.addTokenPool(distribution.address, totalEntitlementWei, {from: GOVERNANCE_ADDRESS});
  });

  describe("Basic", async () => {
    beforeEach(async () => {
      await bestowClaimableBalance(totalEntitlementWei);
    });

    it("Should revert if treasury contract zero", async () => {
      // Assemble
      // Act
      const distributionPromise = DistributionToDelegators.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, PRICE_SUBMITTER_ADDRESS, constants.ZERO_ADDRESS, totalEntitlementWei);
      // Assert
      await expectRevert(distributionPromise, ERR_ADDRESS_ZERO);
    });

    it("Should only opt out once", async () => {
      // Assemble
      // Act
      // Assert
      const optOutTx = await distribution.optOutOfAirdrop({from: accounts[2]});
      expectEvent(optOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: false});
      const optOutPromise1 = distribution.optOutOfAirdrop({from: accounts[2]});
      await expectRevert(optOutPromise1, ERR_OPT_OUT);
      const confirmOptOutTx = await distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      expectEvent(confirmOptOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: true});
      const confirmOptOutPromise1 = distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      await expectRevert(confirmOptOutPromise1, ERR_OPT_OUT);
      const optOutPromise2 = distribution.optOutOfAirdrop({from: accounts[2]});
      await expectRevert(optOutPromise2, ERR_OPT_OUT);
    });

    it("Should not confirm opt out if user has not opted out", async () => {
      // Assemble
      // Act
      const confirmOptOutPromise1 = distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(confirmOptOutPromise1, ERR_NOT_OPT_OUT);
    });

    it("Should not confirm opt out if not from governance", async () => {
      // Assemble
      // Act
      const confirmOptOutPromise1 = distribution.confirmOptOutOfAirdrop([accounts[2]], {from: accounts[1]});
      // Assert
      await expectRevert(confirmOptOutPromise1, ERR_ONLY_GOVERNANCE);
    });

    it("Should not stop distribution if not from governance", async () => {
      // Assemble
      // Act
      const stopPromise = distribution.stop({from: accounts[1]});
      // Assert
      await expectRevert(stopPromise, ERR_ONLY_GOVERNANCE);
    });

    it("Should only update once per block", async () => {
      // signer for ethers (truffle does not work in automining mode)
      const signer = await ethers.getSigner(INFLATION_ADDRESS);
      const supplyEth = Supply__factory.connect(supply.address, signer);
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await time.increaseTo(start.addn(86400 * 8));
      try {
        // switch to manual mining
        await network.provider.send('evm_setAutomine', [false]);
        await network.provider.send("evm_setIntervalMining", [0]);
        // Act
        await supplyEth.updateCirculatingSupply();
        await supplyEth.updateCirculatingSupply();
        await network.provider.send('evm_mine');
        // Assert
        // cannot test that it was really called only once - check coverage html
      } finally {
        await network.provider.send('evm_setAutomine', [true]);
      }
    })
  });

  describe("Claiming", async () => {
    beforeEach(async () => {
      await bestowClaimableBalance(totalEntitlementWei);
    });

    it("Should not be able to claim anything from month >= 36", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await time.increase(1);
      // Act
      // Assert
      const claimableTx = distribution.getClaimableAmount(36);
      await expectRevert(claimableTx, ERR_MONTH_NOT_CLAIMABLE);
      const claimTx = distribution.claim(accounts[0], 36);
      await expectRevert(claimTx, ERR_MONTH_NOT_CLAIMABLE);
    });

    it("Should not be able to claim anything on day 0", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await time.increase(1);
      // Act
      // Assert
      const claimableTx = distribution.getClaimableAmount(0);
      await expectRevert(claimableTx, ERR_MONTH_NOT_CLAIMABLE_YET);
      const claimTx = distribution.claim(accounts[0], 0);
      await expectRevert(claimTx, ERR_MONTH_NOT_CLAIMABLE_YET);
    });

    it("Should not be able to claim anything on day 28", async () => {
      // Assemble
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await time.increaseTo(start.addn(86400 * 28));
      // Act
      const claimableTx = distribution.getClaimableAmount(0);
      const claimTx = distribution.claim(accounts[0], 0);
      // Assert
      await expectRevert(claimableTx, ERR_MONTH_NOT_CLAIMABLE_YET);
      await expectRevert(claimTx, ERR_MONTH_NOT_CLAIMABLE_YET);
    });

    it("Should be able to claim 2.37% after day 30 on private or personal delegation account", async () => {
      // Assemble
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances = [500, 2000, 1500];
      const numberOfBlocks = 12 * days;
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 1;
      await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      // Act
      const claimable1 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx1 = await distribution.claim(accounts[5], 0, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));

      const claimable2 = await distribution.getClaimableAmount(0, {from: accounts[2]});
      const startBalance6 = toBN(await web3.eth.getBalance(accounts[6]));
      const claimTx2 = await distribution.claim(accounts[6], 0, {from: accounts[2]});
      const endBalance6 = toBN(await web3.eth.getBalance(accounts[6]));

      const claimTx3Promise = distribution.claimToPersonalDelegationAccount(0, {from: accounts[3]});
      await expectRevert(claimTx3Promise, ERR_DELEGATION_ACCOUNT_ZERO);
      const delegationAccountManagerInterface = await DelegationAccountManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER);
      const accountToDelegationAccount = delegationAccountManagerInterface.contract.methods.accountToDelegationAccount(accounts[3]).encodeABI();
      await delegationAccountManagerMock.givenCalldataReturnAddress(accountToDelegationAccount, accounts[7]);
      const claimable3 = await distribution.getClaimableAmount(0, {from: accounts[3]});
      const startBalance7 = toBN(await web3.eth.getBalance(accounts[7]));
      const claimTx3 = await distribution.claimToPersonalDelegationAccount(0, {from: accounts[3]});
      const endBalance7 = toBN(await web3.eth.getBalance(accounts[7]));
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500).divn(500 + 2000 + 1500).toNumber());
      expectEvent(claimTx1, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable1});
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable1.toNumber());
      assert.equal(claimable2.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).muln(2000).divn(2000 + 1500).toNumber());
      expectEvent(claimTx2, "AccountClaimed", {whoClaimed: accounts[2], sentTo: accounts[6], month: toBN(0), amountWei: claimable2});
      expect(endBalance6.sub(startBalance6).toNumber()).to.equals(claimable2.toNumber());
      assert.equal(claimable3.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).sub(claimable2).toNumber());
      expectEvent(claimTx3, "AccountClaimed", {whoClaimed: accounts[3], sentTo: accounts[7], month: toBN(0), amountWei: claimable3});
      expect(endBalance7.sub(startBalance7).toNumber()).to.equals(claimable3.toNumber());
      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable1.add(claimable2).add(claimable3).toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);
    });

    it("Should not be able to claim after opt out - others can still claim 2.37% after day 30", async () => {
      // Assemble
      const optOutTx = await distribution.optOutOfAirdrop({from: accounts[2]});
      expectEvent(optOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: false});
      const confirmOptOutTx = await distribution.confirmOptOutOfAirdrop([accounts[2]], {from: GOVERNANCE_ADDRESS});
      expectEvent(confirmOptOutTx, "AccountOptOut", {theAccount: accounts[2], confirmed: true});
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances = [500, 2000, 1500];
      const numberOfBlocks = 12 * days;
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 1;
      await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      // Act
      const claimable1 = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx1 = await distribution.claim(accounts[5], 0, {from: accounts[1]});
      const endBalance5 = toBN(await web3.eth.getBalance(accounts[5]));
      const claimable1_after = await distribution.getClaimableAmountOf(accounts[1], 0);
      const claimed1 = await distribution.getClaimedAmountOf(accounts[1], 0, {from: accounts[1]});
      const claimable4_1 = await distribution.getClaimableAmountOf(accounts[4], 0);
      const claimTx4 = await distribution.claim(accounts[6], 0, {from: accounts[4]});
      const claimable3 = await distribution.getClaimableAmount(0, {from: accounts[3]});
      const startBalance7 = toBN(await web3.eth.getBalance(accounts[7]));
      const claimTx3_1 = await distribution.claim(accounts[7], 0, {from: accounts[3]});
      const endBalance7 = toBN(await web3.eth.getBalance(accounts[7]));
      const claimable3_after = await distribution.getClaimableAmountOf(accounts[3], 0, {from: accounts[3]});
      const claimed3 = await distribution.getClaimedAmount(0, {from: accounts[3]});
      const claimable4_2 = await distribution.getClaimableAmountOf(accounts[4], 0);
      const claimTx3_2 = await distribution.claim(accounts[7], 0, {from: accounts[3]});
      // Assert
      assert.equal(claimable1.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500).divn(500 + 1500).toNumber());
      expectEvent(claimTx1, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable1});
      expect(endBalance5.sub(startBalance5).toNumber()).to.equals(claimable1.toNumber());
      assert.equal(claimable1_after.toNumber(), 0);
      assert.equal(claimable1.toNumber(), claimed1.toNumber());
      assert.equal(claimable4_1.toNumber(), 0);
      expectEvent.notEmitted(claimTx4, "AccountClaimed");
      assert.equal(claimable3.toNumber(), totalEntitlementWei.muln(237).divn(8500).sub(claimable1).toNumber());
      expectEvent(claimTx3_1, "AccountClaimed", {whoClaimed: accounts[3], sentTo: accounts[7], month: toBN(0), amountWei: claimable3});
      expect(endBalance7.sub(startBalance7).toNumber()).to.equals(claimable3.toNumber());
      assert.equal(claimable3_after.toNumber(), 0);
      assert.equal(claimable3.toNumber(), claimed3.toNumber());
      assert.equal(claimable4_2.toNumber(), 0);
      expectEvent.notEmitted(claimTx3_2, "AccountClaimed");
      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable1.add(claimable3).toNumber());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals((await distribution.totalAvailableAmount(0)).toNumber());
      expect((await distribution.totalUnclaimedAmount(0)).toNumber()).to.equals(0);
      expect((await distribution.totalUnclaimedWeight(0)).toNumber()).to.equals(0);

      const claimRevertPromise = distribution.claim(accounts[6], 0, {from: accounts[2]});
      await expectRevert(claimRevertPromise, ERR_OPT_OUT);
    });

    it("Should burn unclaimed rewards after block expiration period", async () => {
      // Assemble
      const days = 30;
      const addresses = [accounts[1], accounts[2], accounts[3]];
      const wNatBalances = [500, 2000, 1500];
      const numberOfBlocks = 12 * days;
      const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 1;
      await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);

      const { 0: allocatedWei1, 1: inflationWei1, 2: claimedWei1 } = await distribution.getTokenPoolSupplyData.call();
      // Assert
      assert.equal(allocatedWei1.toString(10), totalEntitlementWei.toString());
      assert.equal(inflationWei1.toString(10), "0");
      assert.equal(claimedWei1.toString(10), "0");

      // Act
      const claimable = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx = await distribution.claim(accounts[5], 0, {from: accounts[1]});
      const endBalance = toBN(await web3.eth.getBalance(accounts[5]));
      assert.equal(claimable.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500).divn(500 + 2000 + 1500).toNumber());
      expectEvent(claimTx, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable});
      expect(endBalance.sub(startBalance).toNumber()).to.equals(claimable.toNumber());
      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);

      const { 0: allocatedWei2, 1: inflationWei2, 2: claimedWei2 } = await distribution.getTokenPoolSupplyData.call();
      assert.equal(allocatedWei2.toString(10), totalEntitlementWei.toString());
      assert.equal(inflationWei2.toString(10), "0");
      assert.equal(claimedWei2.toString(10), claimable.toString());
      
      const monthToExpireNext1 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext1.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const monthToExpireNext2 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext2.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const cleanupBlockNumber = (await distribution.startBlockNumber(0)).toNumber() + 1;
      const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
      await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);
      const monthToExpireNext3 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext3.toNumber()).to.equals(1);
      const claimPromise1 = distribution.claim(accounts[6], 0, {from: accounts[2]});
      await expectRevert(claimPromise1, ERR_MONTH_EXPIRED);

      const burnAddress = await supply.burnAddress();
      const startBalanceBurn = toBN(await web3.eth.getBalance(burnAddress));
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const endBalanceBurn = toBN(await web3.eth.getBalance(burnAddress));
      const monthToExpireNext4 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext4.toNumber()).to.equals(1);
      const claimPromise2 = distribution.claim(accounts[6], 0, {from: accounts[2]});
      await expectRevert(claimPromise2, ERR_MONTH_EXPIRED);

      const { 0: allocatedWei3, 1: inflationWei3, 2: claimedWei3 } = await distribution.getTokenPoolSupplyData.call();
      assert.equal(allocatedWei3.toString(10), totalEntitlementWei.toString());
      assert.equal(inflationWei3.toString(10), "0");
      assert.equal(claimedWei3.toString(10), totalEntitlementWei.muln(237).divn(8500).toString());
      expect((await distribution.totalClaimedWei()).toNumber()).to.equals(claimable.toNumber());
      expect((await distribution.totalBurnedWei()).toNumber()).to.equals(totalEntitlementWei.muln(237).divn(8500).sub(claimable).toNumber());
      expect((endBalanceBurn.sub(startBalanceBurn)).toNumber()).to.equals(totalEntitlementWei.muln(237).divn(8500).sub(claimable).toNumber());
      expect((await distribution.totalAvailableAmount(0)).toNumber()).to.equals(totalEntitlementWei.muln(237).divn(8500).toNumber());
      expect((await distribution.totalDistributableAmount()).toNumber()).to.equals(totalEntitlementWei.muln(237 * 3).divn(8500).toNumber());
    });

    it("Should not pull funds if stopped, but expiration should still work", async () => {
      // Assemble
      const days = 30;
      await time.advanceBlock();
      const start = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(start, {from: GOVERNANCE_ADDRESS});
      await createSomeBlocksAndProceed(start, days);
      
      const monthToExpireNext1 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext1.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const monthToExpireNext2 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext2.toNumber()).to.equals(0);
      await createSomeBlocksAndProceed(await time.latest(), days);

      const cleanupBlockNumber = (await distribution.startBlockNumber(0)).toNumber() + 1;
      const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
      await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);

      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const monthToExpireNext3 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext3.toNumber()).to.equals(1);
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});

      const { 0: allocatedWei, 2: claimedWei } = await distribution.getTokenPoolSupplyData.call();
      const circulatingSupply = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      const inflatableBalance = await supply.getInflatableBalance();
      assert.equal(allocatedWei.toString(10), totalEntitlementWei.toString());
      assert.equal(claimedWei.toNumber(), totalEntitlementWei.muln(237).divn(8500).toNumber());
      assert.equal(await (await supply.distributedExcludedSupplyWei()).toString(10), totalEntitlementWei.toString());
      await distribution.stop({from: GOVERNANCE_ADDRESS});
      const distributableAmount = totalEntitlementWei.muln(237 * 3).divn(8500);
      const { 0: allocatedWei2 } = await distribution.getTokenPoolSupplyData.call();
      assert.equal(allocatedWei2.toString(10), distributableAmount.toString());
      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const { 0: allocatedWei3 } = await distribution.getTokenPoolSupplyData.call();
      const circulatingSupply2 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      const inflatableBalance2 = await supply.getInflatableBalance();
      assert.equal(allocatedWei3.toString(10), distributableAmount.toString());
      assert.equal(await (await supply.distributedExcludedSupplyWei()).toString(10), distributableAmount.toString());
      assert.equal(circulatingSupply2.toNumber(), circulatingSupply.toNumber());
      assert.equal(inflatableBalance2.toNumber(), inflatableBalance.toNumber());

      for (let i = 1; i <= 36; i++) {
        const currentMonth = await distribution.getCurrentMonth();
        expect(currentMonth.toNumber()).to.equals(i + 2);
        const monthToExpireNext = await distribution.getMonthToExpireNext();
        expect(monthToExpireNext.toNumber()).to.equals(i);
        await createSomeBlocksAndProceed(await time.latest(), days);

        const cleanupBlockNumber = (await distribution.startBlockNumber(i)).toNumber() + 1;
        const cleanupBlockNumberWnat = wNatInterface.contract.methods.cleanupBlockNumber().encodeABI();
        await wNatMock.givenCalldataReturnUint(cleanupBlockNumberWnat, cleanupBlockNumber);
      }

      await supply.updateCirculatingSupply({from: INFLATION_ADDRESS});
      const monthToExpireNext4 = await distribution.getMonthToExpireNext();
      expect(monthToExpireNext4.toNumber()).to.equals(36);
      expect((await distribution.totalBurnedWei()).toNumber()).to.equals(distributableAmount.toNumber());
      expect((await distribution.totalDistributableAmount()).toNumber()).to.equals(distributableAmount.toNumber());
    });
  });

  describe("Time till next claimable Wei", async () => {
    let nowTs: BN;

    beforeEach(async () => {
      await bestowClaimableBalance(totalEntitlementWei);
      await time.advanceBlock();
      nowTs = (await time.latest()).addn(10);
      await distribution.setEntitlementStart(nowTs, {from: GOVERNANCE_ADDRESS});
    });

    it("Should revert if not started yet", async () => {
      const timeTillClaim_promise = distribution.secondsTillNextClaim();
      await expectRevert(timeTillClaim_promise, ERR_NOT_STARTED);
    });

    it("Should be 30 days right after start", async () => {
      await time.increase(10);
      const timeTillClaim = await distribution.secondsTillNextClaim();
      assert.equal(timeTillClaim.toNumber(), 30 * 24 * 60 * 60 - 1);
    });

    it("Should be 10 days after 20 days has passed", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 20)));
      const timeTillClaim = await distribution.secondsTillNextClaim();
      assert.equal(timeTillClaim.toNumber(), 10 * 24 * 60 * 60);
    });

    it("Should be 7 days after 53 days has passed", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 53)));
      const timeTillClaim = await distribution.secondsTillNextClaim();
      assert.equal(timeTillClaim.toNumber(), 7 * 24 * 60 * 60);
    });

    it("Should be 1 second just before end of distribution", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 30).muln(36).subn(1)));
      const timeTillClaim = await distribution.secondsTillNextClaim();
      assert.equal(timeTillClaim.toNumber(), 1);
    });

    it("Should Revert after 36 months has passed", async () => {
      await time.increaseTo(nowTs.add(BN(86400 * 30).muln(36)));
      const timeTillClaim_promise = distribution.secondsTillNextClaim();
      await expectRevert(timeTillClaim_promise, ERR_ALREADY_FINISHED);
    });
  });

  describe("entitlement startup", async () => {

    it("Should start entitlement", async () => {
      // Assemble
      await bestowClaimableBalance(totalEntitlementWei);
      // Act
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now, {from: GOVERNANCE_ADDRESS});
      // Assert
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
    });

    it("Should emit entitlement start event", async () => {
      // Assemble
      await bestowClaimableBalance(totalEntitlementWei);
      // Act
      const now = (await time.latest()).addn(1);
      const startEvent = await distribution.setEntitlementStart(now, {from: GOVERNANCE_ADDRESS});
      // Assert
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      expectEvent(startEvent, "EntitlementStarted");
    });

    it("Should not start entitlement if not in balance", async () => {
      // Assemble
      await bestowClaimableBalance(BN(8000));
      // Act
      const now = (await time.latest()).addn(1);
      let start_promise = distribution.setEntitlementStart(now, {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(start_promise, ERR_BALANCE_TOO_LOW);
    });

    it("Should not start entitlement if not from governance", async () => {
      // Assemble
      await bestowClaimableBalance(totalEntitlementWei);
      // Act
      const now = (await time.latest()).addn(1);
      let start_promise = distribution.setEntitlementStart(now, { from: accounts[1] });
      // Assert
      await expectRevert(start_promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not allow entitlement start to be reset", async () => {
      // Assemble
      await bestowClaimableBalance(totalEntitlementWei);
      const now = (await time.latest()).addn(1);
      await distribution.setEntitlementStart(now, {from: GOVERNANCE_ADDRESS});
      const entitlementStartTs = await distribution.entitlementStartTs();
      assert(entitlementStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      const restart_promise = distribution.setEntitlementStart(later, {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(restart_promise, ERR_NOT_ZERO);
    });

    it("Should not allow entitlement to start in past", async () => {
      // Assemble
      await bestowClaimableBalance(totalEntitlementWei);
      const now = (await time.latest()).subn(10);
      // Act
      const in_the_past_promise = distribution.setEntitlementStart(now, {from: GOVERNANCE_ADDRESS});
      // Assert
      await expectRevert(in_the_past_promise, ERR_IN_THE_PAST);
    });
  });
});
