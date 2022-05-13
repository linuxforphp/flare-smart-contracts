import { DistributionToDelegatorsInstance, DistributionTreasuryInstance, MockContractInstance, SupplyInstance, WNatInstance } from "../../../../typechain-truffle";
import { encodeContractNames, toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;
const { sumGas, calcGasCost } = require('../../../utils/eth');
import { expectRevert, expectEvent, time, constants } from '@openzeppelin/test-helpers';
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { Contracts } from "../../../../deployment/scripts/Contracts";

const BN = web3.utils.toBN;

const DistributionTreasury = artifacts.require("DistributionTreasury");
const DistributionToDelegators = artifacts.require("DistributionToDelegators");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");
const WNat = artifacts.require("WNat");
const Supply = artifacts.require("Supply");

const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_BALANCE_TOO_LOW = "balance too low";
const ERR_TOO_MUCH = "too much"
const ERR_NOT_ZERO = "not zero";
const ERR_IN_THE_PAST = "in the past";
const ERR_OPT_OUT = "already opted out";
const ERR_NOT_STARTED = "not started";
const ERR_ALREADY_FINISHED = "already finished";
const ERR_NO_BALANCE_CLAIMABLE = "no balance currently available";
const ERR_ARRAY_MISMATCH = "arrays lengths mismatch";
const ERR_TOO_MANY = "too many";
const ERR_NOT_REGISTERED = "not registered";
const ERR_MONTH_NOT_CLAIMABLE_YET = "month not claimable yet";

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
    
    await supply.addTokenPool(distribution.address, 0, {from: GOVERNANCE_ADDRESS});
  });

  describe("Basic", async () => {
    beforeEach(async () => {
      await bestowClaimableBalance(totalEntitlementWei);
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

    it("Should be able to claim 2.37% after day 30", async () => {
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
      const claimable = await distribution.getClaimableAmount(0, {from: accounts[1]});
      const startBalance = toBN(await web3.eth.getBalance(accounts[5]));
      const claimTx = await distribution.claim(accounts[5], 0, {from: accounts[1]});
      const endBalance = toBN(await web3.eth.getBalance(accounts[5]));
      // Assert
      assert.equal(claimable.toNumber(), totalEntitlementWei.muln(237).divn(8500).muln(500).divn(500 + 2000 + 1500).toNumber());
      expectEvent(claimTx, "AccountClaimed", {whoClaimed: accounts[1], sentTo: accounts[5], month: toBN(0), amountWei: claimable});
      expect(endBalance.sub(startBalance).toNumber()).to.equals(claimable.toNumber());
      expect((await distribution.startBlockNumber(0)).toNumber()).to.be.gte(startBlockNumber);
      expect((await distribution.endBlockNumber(0)).toNumber()).to.be.lt(startBlockNumber + numberOfBlocks);
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
      await time.increaseTo(nowTs.add(BN(86400 * 30).muln(29).subn(1)));
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

  // describe("Token Pool tests", async () => {

  //   it("Returns proper token pool numbers to be used by token pool at initial time", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     const { 0: allocatedWei, 1: inflationWei, 2: claimedWei } = await distribution.getTokenPoolSupplyData.call();
  //     // Assert
  //     assert.equal(allocatedWei.toString(10), "8500");
  //     assert.equal(inflationWei.toString(10), "0");
  //     assert.equal(claimedWei.toString(10), "0");
  //   });

  //   it("Returns proper token pool numbers after some claiming", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     await time.increaseTo(now.add(BN(86400 * 30).muln(29).addn(150)));
  //     for (let i of [0, 1, 2, 3, 4, 5]) {
  //       await distribution.claim(claimants[i], { from: claimants[i] });
  //     }
  //     // Assert
  //     let { 0: allocatedWei, 1: inflationWei, 2: claimedWei } = await distribution.getTokenPoolSupplyData.call();
  //     assert.equal(allocatedWei.toString(10), "8500");
  //     assert.equal(inflationWei.toString(10), "0");
  //     assert.equal(claimedWei.toString(10), "5100");
  //   });
  // });

  // describe("Claiming", async () => {
  //   beforeEach(async () => {
  //     await bulkLoad(BN(1000));
  //   });

  //   it("Should not be able to claim before entitelment start", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     // Act
  //     const claimPrommise = distribution.claim(claimants[0], { from: claimants[0] });
  //     // Assert
  //     await expectRevert(claimPrommise, ERR_NOT_STARTED);
  //   });

  //   it("Should not be able to claim if not registered to distribution", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     const optOutRevert = distribution.claim(accounts[150], { from: accounts[150] });
  //     // Assert
  //     await expectRevert(optOutRevert, ERR_NOT_REGISTERED);
  //   });

  //   it("Should claim claimable entitlement 1 month from start", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Time travel to next month
  //     await time.increaseTo(now.addn(86400 * 31));
  //     // Act
  //     const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
  //     const claimResult = await distribution.claim(claimants[0], { from: claimants[0] });
  //     // Assert
  //     const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
  //     let txCost = BN(await calcGasCost(claimResult));
  //     assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 1000 * 3 / 100);
  //   });

  //   it("Should emit claiming event", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Time travel to next month
  //     await time.increaseTo(now.addn(86400 * 31));
  //     // Act
  //     const claimResult = await distribution.claim(claimants[0], { from: claimants[0] });
  //     // Assert
  //     expectEvent(claimResult, EVENT_ACCOUNT_CLAIM);
  //   });

  //   it("Should update variables after claimal", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     await time.increaseTo(now.addn(86400 * 31));
  //     const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
  //     const claimResult = await distribution.claim(claimants[0], { from: claimants[0] });
  //     const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
  //     let txCost = BN(await calcGasCost(claimResult));
  //     assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 1000 * 3 / 100);
  //     // Act
  //     const {
  //       0: entitlementBalanceWei1,
  //       1: totalClaimedWei1,
  //       2: optOutBalance1,
  //       3: airdroppedWei1
  //     } = await distribution.airdropAccounts(claimants[0]);
  //     const {
  //       0: entitlementBalanceWei2,
  //       1: totalClaimedWei2,
  //       2: optOutBalance2,
  //       3: airdroppedWei2
  //     } = await distribution.airdropAccounts(claimants[1]);
  //     const totalEntitlementWei = await distribution.totalEntitlementWei();
  //     const totalClaimedWei = await distribution.totalClaimedWei();
  //     // Assert
  //     assert.equal(entitlementBalanceWei1.toNumber(), 850);
  //     assert.equal(totalClaimedWei1.toNumber(), 30);
  //     assert.equal(optOutBalance1.toNumber(), 0);
  //     assert.equal(airdroppedWei1.toNumber(), 150);
  //     assert.equal(entitlementBalanceWei2.toNumber(), 850);
  //     assert.equal(totalClaimedWei2.toNumber(), 0);
  //     assert.equal(optOutBalance2.toNumber(), 0);
  //     assert.equal(airdroppedWei2.toNumber(), 150);
  //     assert.equal(totalEntitlementWei.toNumber(), 8500);
  //     assert.equal(totalClaimedWei.toNumber(), 30);
  //   });

  //   it("Should not be able to claim if no funds are claimable at given time", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
  //     // Assert
  //     await expectRevert(claimResult, ERR_NO_BALANCE_CLAIMABLE);
  //   });

  //   it("Should not be able to claim if already claimed in this month", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     await time.increaseTo(now.add(BN(86400 * 30).muln(2).addn(150)));
  //     await distribution.claim(claimants[0], { from: claimants[0] });
  //     const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
  //     // Assert
  //     await expectRevert(claimResult, ERR_NO_BALANCE_CLAIMABLE);
  //   });

  //   it("Should not be able to claim after opt-out", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     await distribution.optOutOfAirdrop({ from: claimants[0] });
  //     await time.increaseTo(now.add(BN(86400 * 30).muln(2).addn(150)));
  //     const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
  //     // Assert
  //     await expectRevert(claimResult, ERR_OPT_OUT);
  //   });

  //   it("Should emit opt-out event", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     const optOutEvent = await distribution.optOutOfAirdrop({ from: claimants[0] });
  //     // Assert
  //     expectEvent(optOutEvent, EVENT_ACCOUNT_OPT_OUT);
  //   });

  //   it("Should not be able to opt-out if not registered to distribution", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     const optOutRevert = distribution.optOutOfAirdrop({ from: accounts[150] });
  //     // Assert
  //     await expectRevert(optOutRevert, ERR_NOT_REGISTERED);
  //   });

  //   it("Should not be able to opt-out after fully claimed", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     await time.increaseTo(now.add(BN(86400 * 30).muln(29).addn(150)));
  //     await distribution.claim(claimants[0], { from: claimants[0] });
  //     const optOutRevert = distribution.optOutOfAirdrop({ from: claimants[0] });
  //     // Assert
  //     await expectRevert(optOutRevert, ERR_FULLY_CLAIMED);
  //   });

  //   it("Should not be able to claim wei after opt-out even if it was allocated", async () => {
  //     // Assemble
  //     await bestowClaimableBalance(BN(8500));
  //     const now = await time.latest();
  //     await distribution.setEntitlementStart(now);
  //     // Act
  //     await time.increaseTo(now.add(BN(86400 * 30).muln(2).addn(150)));
  //     await distribution.optOutOfAirdrop({ from: claimants[0] });
  //     const claimResult = distribution.claim(claimants[0], { from: claimants[0] });
  //     // Assert
  //     await expectRevert(claimResult, ERR_OPT_OUT);
  //     const {
  //       1: cl0totalClaimed,
  //       2: cl0totalOptOut,
  //     } = await distribution.airdropAccounts(claimants[0]);
  //     assert.equal(cl0totalClaimed.toNumber(), 0);
  //     assert.equal(cl0totalOptOut.toNumber(), 850);
  //   });
  // });
});
