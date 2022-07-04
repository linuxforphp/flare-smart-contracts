import { balance, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { SupplyInstance, TeamEscrowInstance } from "../../../../typechain-truffle";
import { emptyAddressBalance } from '../../../utils/contract-test-helpers';
import { encodeContractNames } from "../../../utils/test-helpers";

const Supply = artifacts.require("Supply");

const getTestFile = require('../../../utils/constants').getTestFile;
const { calcGasCost } = require('../../../utils/eth');

const initialGenesisAmountWei = 10 ** 10;
const totalFoundationSupplyWei =  10 ** 5;
const initialCirculatingSupply = initialGenesisAmountWei - totalFoundationSupplyWei;
const burnAddress = "0x000000000000000000000000000000000000dEaD";

const BN = web3.utils.toBN;

const TeamEscrow = artifacts.require("TeamEscrow");
const MockClaim = artifacts.require("GasConsumer2");

contract(`TeamEscrow.sol; ${getTestFile(__filename)}; TeamEscrow unit tests`, async accounts => {
  let escrow: TeamEscrowInstance;
  let claimants: string[] = [];
  const GOVERNANCE_ADDRESS = accounts[0];
  let latestStart: BN;

  beforeEach(async () => {
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    escrow = await TeamEscrow.new(GOVERNANCE_ADDRESS, latestStart);
    // Build an array of claimant accounts
    for (let i = 0; i < 10; i++) {
      claimants[i] = accounts[i + 1];
    }
  });

  describe("Basic", async() => {
    it("Should revert if latest start time in the past", async () => {
      // Assemble
      // Act
      const teamEscrowPromise = TeamEscrow.new(GOVERNANCE_ADDRESS, (await time.latest()).subn(5));
      // Assert
      await expectRevert(teamEscrowPromise, "In the past");
    });
  });

  describe("Locking", async() => {
    it("Should not be able to get claimbale bips", async() => {
      const now = (await time.latest()).addn(1);
      await expectRevert(escrow.getCurrentClaimablePercentBips(now), "Claiming not started");
    });

    it("Should enable locking", async() => {
      const locked = BN(await web3.eth.getBalance(claimants[0])).divn(10);
      await escrow.lock({from: claimants[0], value: locked});
      const lockedBalance = await escrow.lockedAmounts(claimants[0]);
      expect(locked.eq(lockedBalance[0]));
    });

    it("Should be able to lock some more", async() => {
      const locked = BN(await web3.eth.getBalance(claimants[0])).divn(10);
      await escrow.lock({from: claimants[0], value: locked});
      await escrow.lock({from: claimants[0], value: locked});
      const lockedBalance = await escrow.lockedAmounts(claimants[0]);
      expect(locked.muln(2).eq(lockedBalance[0]));
    });

    it("Should not allow claiming start to be pushed in the past", async () => {
      // Assemble
      const now = (await time.latest()).addn(10);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const before = now.subn(60 * 60 * 24 * 5);
      const restart_promise = escrow.setClaimingStartTs(before);
      // Assert
      await expectRevert(restart_promise, "Wrong start timestamp");
    });

    it("Should allow claiming start to be pushed in the future", async () => {
      // Assemble
      const now = (await time.latest()).addn(10);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      await escrow.setClaimingStartTs(later);
      // Assert
      const claimStartTs2 = await escrow.claimStartTs();
      assert(claimStartTs2.eq(later));
    });

    it("Should not allow claiming start to be pushed in the future if already started", async () => {
      // Assemble
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      const restart_promise = escrow.setClaimingStartTs(later);
      // Assert
      await expectRevert(restart_promise, "Already started");
    });

    it("Should not allow claiming start to be pushed to far in the future", async () => {
      // Assemble
      const now = (await time.latest()).addn(10);
      await escrow.setClaimingStartTs(now);
      const claimStartTs = await escrow.claimStartTs();
      assert(claimStartTs.eq(now));
      // Act
      const later = now.subn(60 * 60 * 24 * 10);
      const restart_promise = escrow.setClaimingStartTs(later);
      // Assert
      await expectRevert(restart_promise, "Wrong start timestamp");
    });

  })

  describe("Collection", async() => {

    it("Should not collect before start is set", async() => {
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(2);

      const tx = escrow.claim({from: claimants[0]});
      await expectRevert(tx, "Claiming not started");
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
      // Nothing to claim
      const tx2 = escrow.claim({from: claimants[0]});
      await expectRevert(tx2, "No claimable funds");

      await time.increaseTo(now.addn(86400 * 31));
      // Should go ok
      await escrow.claim({from: claimants[0]});
    
    });

    it("Should not collect before start timestamp", async() => {
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);

      const tx = escrow.claim({from: claimants[0]});
      await escrow.setClaimingStartTs(now.addn(200), {from: GOVERNANCE_ADDRESS});
      await expectRevert(tx, "Claiming not started");
      await time.increaseTo(now.addn(86400 * 31));
      // Should go ok
      await escrow.claim({from: claimants[0]});
    
    });

    it("Should collect funds", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
    });

    it("Should collect funds multiple times", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);

    });

    it("Should not overclaim", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      const openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      const closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      const txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again without time increase

      // Act
      const tx = escrow.claim({ from: claimants[0] });
      // Assert

      await expectRevert(tx, "No claimable funds");

    });

    it("Should not exaust claim before 36 months", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again after a long time
      await time.increaseTo(now.add(BN(86400).muln(30 * 35))); // 30 months

      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 8500 - 237 - 237 - 205); // The last month is not claimed
    });

    it("Should exaust claim in 36 months", async() => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);
      
      // Claim again after a long time
      await time.increaseTo(now.add(BN(86400).muln(30 * 36))); // 36 months

      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 8500 - 237 - 237);
    });
  });

  describe("Collection", async() => {
    it("Should enable claiming to a different address", async () => {
      // Lock some funds
      const locked = BN(8500)
      await escrow.lock({from: claimants[0], value: locked});
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});

      await time.increaseTo(now.addn(86400 * 31));
      // Act
      let openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      let closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      let txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 237);

      // Claim again, to a different address
      await time.increaseTo(now.addn(86400 * 31).addn(86400 * 31));
      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[1]));
      claimResult = await escrow.claimTo(claimants[1], { from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[1]));
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 237);

      // Claim to original address
      // Claim again after a long time
      await time.increaseTo(now.add(BN(86400).muln(30 * 36))); // 36 months

      // Act
      openingBalance = BN(await web3.eth.getBalance(claimants[0]));
      claimResult = await escrow.claim({ from: claimants[0] });
      // Assert

      closingBalance = BN(await web3.eth.getBalance(claimants[0]));
      txCost = BN(await calcGasCost(claimResult));
      assert.equal(txCost.add(closingBalance).sub(openingBalance).toNumber(), 8500 - 237 - 237);
    });

    it("Should fail to claim", async() => {
       // Lock some funds
       const locked = BN(8500)
       await escrow.lock({from: claimants[0], value: locked});
       const now = (await time.latest()).addn(1);
       await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
 
       await time.increaseTo(now.addn(86400 * 31));
      
       let mockClaim = await MockClaim.new(5);
       let claimResult = escrow.claimTo(mockClaim.address, { from: claimants[0] });
       await expectRevert(claimResult, "Failed to call claiming contract");
    });

  });

  describe("Integrates with supply", async () => {
    const ADDRESS_UPDATER = accounts[16];
    const governanceAddress = accounts[10];
    const inflationAddress = accounts[9];
    // contains a fresh contract for each test 
    let supply: SupplyInstance;

    beforeEach(async() => {
        // clean up burnAddress
        await emptyAddressBalance(burnAddress, accounts[0]);
        assert.equal(Number(await balance.current(burnAddress)), 0);
        //
        supply = await Supply.new(governanceAddress, ADDRESS_UPDATER, initialGenesisAmountWei, totalFoundationSupplyWei, []);
        await supply.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
            [ADDRESS_UPDATER, inflationAddress], {from: ADDRESS_UPDATER});
    });

    it("Sends correct information to supply", async() => {
      await supply.addTokenPool(escrow.address, 0, {from: governanceAddress});

      // Do some claiming
      const locked1 = BN(8500)
      const locked2 = BN(85000)
      const locked3 = BN(8500)

      await escrow.lock({from: claimants[0], value: locked1});

      // Force recalculation of supply
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be decreased by locked1 amount
      const supplyAfterLock1 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLock1.toNumber(), initialCirculatingSupply - locked1.toNumber());
      // Inflatable supply should be decreased by locked1 amount
      const inflatableSupplyAfterLock1 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterLock1.toNumber(), initialCirculatingSupply - locked1.toNumber());
      
      // Lock another guy
      await escrow.lock({from: claimants[1], value: locked2});
      // Check locked for both

      // Force recalculation of supply
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be decreased by locked2 amount
      const supplyAfterLock2 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLock2.toNumber(), initialCirculatingSupply - locked2.toNumber() - locked1.toNumber());
      // Inflatable supply should be decreased by locked2 amount
      const inflatableSupplyAfterLock2 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterLock2.toNumber(), initialCirculatingSupply - locked2.toNumber() - locked1.toNumber());

      // Move time forward
      const now = (await time.latest()).addn(1);
      await escrow.setClaimingStartTs(now, {from: GOVERNANCE_ADDRESS});
      await time.increaseTo(now.addn(86400 * 30));

      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Nothing should change until claim is made
      const supplyAfterLockBeforeClaim = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLockBeforeClaim.toNumber(), supplyAfterLock2.toNumber());
      const inflatableSupplyBeforeClaim = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyBeforeClaim.toNumber(), inflatableSupplyAfterLock2.toNumber());

      // Make claim for first one
      await escrow.claim({from: claimants[0]});

      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be increased by claimed amount (237)
      const supplyAfterClaim = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterClaim.toNumber(), supplyAfterLock2.toNumber() + 237);
      // Inflatable supply should be increased by claimed amount (237)
      const inflatableSupplyAfterClaim = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterClaim.toNumber(), inflatableSupplyAfterLock2.toNumber() + 237);
      // Locked and claimed amount should be ok
      const calcLocked = await supply.totalLockedWei();
      const calcClaimed = await supply.totalClaimedWei();
      assert.equal(calcLocked.toNumber(), locked2.toNumber() + locked1.toNumber());
      assert.equal(calcClaimed.toNumber(), 237);

      // Increase for another month
      await time.increaseTo(now.addn(86400 * 30 * 2));
      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Nothing should change until claim is made
      const supplyAfterLockLockBeforeClaim = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLockLockBeforeClaim.toNumber(), supplyAfterLock2.toNumber() + 237);
      const inflatableSupplyBeforeSecondClaim = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyBeforeSecondClaim.toNumber(), inflatableSupplyAfterLock2.toNumber() + 237);

      // Lock another one

      await escrow.lock({from: claimants[2], value: locked3});
      await supply.updateCirculatingSupply({from: inflationAddress});

      // Nothing should change
      const supplyAfterLock3 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(supplyAfterLock3.toNumber(), supplyAfterLockLockBeforeClaim.toNumber() - locked3.toNumber());
      // Just a sanity check
      assert.equal(
        supplyAfterLock3.toNumber(), 
        initialCirculatingSupply + 237 - locked3.toNumber() - locked1.toNumber() - locked2.toNumber()
      ); 
      
      const inflatableSupplyAfterLock3 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterLock3.toNumber(), supplyAfterLock3.toNumber());
      
      // Run until end of claiming period
      await time.increaseTo(now.add(BN(86400 * 30).muln(36)).addn(1));
      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Claim third in full
      await escrow.claim({from: claimants[2]});
      // Prime recalculation
      await supply.updateCirculatingSupply({from: inflationAddress});
      // Supply should be increased by claimed amount locked3
      const supplyAfterClaim3 = await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber());
      assert.equal(
        supplyAfterClaim3.toNumber(), 
        initialCirculatingSupply - locked2.toNumber() - locked1.toNumber() + 237
      );
      // Inflatable supply should be increased by claimed amount locked3
      const inflatableSupplyAfterClaim3 = await supply.getInflatableBalance();
      assert.equal(inflatableSupplyAfterClaim3.toNumber(), initialCirculatingSupply - locked2.toNumber() - locked1.toNumber() + 237);

    });
  });
});
