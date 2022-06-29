import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { InitialAirdropInstance } from "../../../../typechain-truffle";
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { getAddressWithZeroBalance } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const InitialAirdrop = artifacts.require("InitialAirdrop");
const SuicidalMock = artifacts.require("SuicidalMock");
const GasConsumer = artifacts.require("GasConsumer");

const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ARRAY_MISMATCH = "arrays lengths mismatch";
const ERR_TOO_MANY = "too many";
const ERR_ALREDY_SET = "already set";
const ERR_ALREADY_STARTED = "already started";
const ERR_WRONG_START_TIMESTAMP = "wrong start timestamp";
const ERR_OUT_OF_BALANCE = "balance too low";
const ERR_NOT_STARTED = "not started";

const EVENT_AIRDROP_START = "AirdropStart";
const EVENT_ACCOUNTS_ADDED = "AccountsAdded";

contract(`InitialAirdrop.sol; ${getTestFile(__filename)}; InitialAirdrop unit tests`, async accounts => {
  let initialAirdrop: InitialAirdropInstance;
  let claimants: string[] = [];
  let latestStart: BN;

  beforeEach(async () => {
    initialAirdrop = await InitialAirdrop.new();
    await initialAirdrop.initialiseFixedAddress();
    await initialAirdrop.transferGovernance(accounts[0], {from: GOVERNANCE_GENESIS_ADDRESS}); // for easier testing
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    await initialAirdrop.setLatestAirdropStart(latestStart);
    
    // Build an array of claimant accounts
    for (let i = 0; i < 10; i++) {
      claimants[i] = accounts[i + 1];
    }
  });

  async function bulkLoad(balance: BN, allClaimants: string[] = claimants) {
    let balances = [];
    for (let i = 0; i < allClaimants.length; i++) {
      balances[i] = balance;
    }
    await initialAirdrop.setAirdropBalances(allClaimants, balances);
  }

  async function bestowClaimableBalance(balance: BN) {
    // Give the initialAirdrop contract the native token required to be in balance with entitlements
    // Our subversive attacker will be suiciding some native token into flareDaemon
    const suicidalMock = await SuicidalMock.new(initialAirdrop.address);
    // Give suicidal some native token
    await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: balance });
    // Attacker dies
    await suicidalMock.die();
  }

  describe("Adding Accounts", async () => {
    it("Should add account", async () => {
      // Assemble
      const balances = [BN(1000), BN(1000), BN(1000), BN(1000), BN(1000),
      BN(1000), BN(1000), BN(1000), BN(1000), BN(1000)];
      await initialAirdrop.setAirdropBalances(claimants, balances);
      // Act
      // Assert
      const totalInitialAirdropWei = await initialAirdrop.totalInitialAirdropWei();
      assert.equal(totalInitialAirdropWei.toNumber(), 1500);
    });

    it("Should emit add accounts event", async () => {
      // Assemble
      const balances = [BN(1000), BN(1000), BN(1000), BN(1000), BN(1000),
      BN(1000), BN(1000), BN(1000), BN(1000), BN(1000)];
      // Act
      const addingEvent = await initialAirdrop.setAirdropBalances(claimants, balances);
      // Assert
      expectEvent(addingEvent, EVENT_ACCOUNTS_ADDED);
    });

    it("Should revert if accounts and balance length don't agree", async () => {
      // Assemble
      const balances = [BN(1000), BN(1000), BN(1000), BN(1000), BN(1000),
      BN(1000), BN(1000), BN(1000), BN(1000)];
      // Act
      const addingEvent = initialAirdrop.setAirdropBalances(claimants, balances);
      // Assert
      await expectRevert(addingEvent, ERR_ARRAY_MISMATCH);
    });

    it("Should revert if we add too many accounts at once", async () => {
      // Assemble
      let addresses = [];
      let balances = [];
      for (let i = 0; i < 1001; i++) {
        let account = web3.eth.accounts.create();
        addresses[i] = account.address;
        balances[i] = web3.utils.toWei(BN(420));
      }
      // Act
      const addingEvent = initialAirdrop.setAirdropBalances(addresses, balances);
      // Assert
      await expectRevert(addingEvent, ERR_TOO_MANY);
    });

    it("Should revert if airdrop already started", async () => {
      // Assemble
      await bulkLoad(BN(1000));
      await bestowClaimableBalance(BN(1500));
      const nowTs = await time.latest() as BN;
      await initialAirdrop.setAirdropStart(nowTs);
      // Act
      const addingEvent = initialAirdrop.setAirdropBalances([accounts[20]], [BN(1000)]);
      // Assert
      await expectRevert(addingEvent, ERR_ALREADY_STARTED);
    });
  });

  describe("account load", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
    });

    it("Should ignore loading bulk again", async () => {
      // Assemble
      // Act
      await bulkLoad(BN(1000));
      // Assert
      const airdropAccountsLength = await initialAirdrop.airdropAccountsLength();
      assert.equal(airdropAccountsLength.toNumber(), claimants.length);
    });

    it("Should bulk load and total account entitlement balances", async () => {
      // Assemble
      // Act
      // Assert
      const totalInitialAirdropWei = await initialAirdrop.totalInitialAirdropWei();
      assert.equal(totalInitialAirdropWei.toNumber(), 1500);
    });

    it("Should have loaded an account with an entitlement balance", async () => {
      // Assemble
      // Act
      // Assert
      const account = await initialAirdrop.airdropAccounts(0);
      const amount = await initialAirdrop.airdropAmountsWei(account);
      assert.equal(account, claimants[0]);
      assert.equal(amount.toNumber(), 150);
    });
  });

  describe("airdrop startup", async () => {
    beforeEach(async () => {
      await bulkLoad(BN(1000));
    });

    it("Should start airdrop", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      // Act
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      // Assert
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(now));
    });

    it("Should emit airdrop start event", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      // Act
      const now = await time.latest();
      const startEvent = await initialAirdrop.setAirdropStart(now);
      // Assert
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(now));
      expectEvent(startEvent, EVENT_AIRDROP_START);
    });

    it("Should not start airdrop if out of balance", async () => {
      // Assemble
      await bestowClaimableBalance(BN(150));
      // Act
      const now = await time.latest();
      let start_promise = initialAirdrop.setAirdropStart(now);
      // Assert
      await expectRevert(start_promise, ERR_OUT_OF_BALANCE);
    });

    it("Should not set latest start of airdrop if not from governance", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      // Act
      const now = await time.latest();
      let start_promise = initialAirdrop.setLatestAirdropStart(now, { from: accounts[1] });
      // Assert
      await expectRevert(start_promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not allow airdrop latest start to be reset", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      const now = await time.latest();
      const restart_promise = initialAirdrop.setLatestAirdropStart(now);
      // Assert
      await expectRevert(restart_promise, ERR_ALREDY_SET);
    });

    it("Should not start airdrop if not from governance", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      // Act
      const now = await time.latest();
      let start_promise = initialAirdrop.setAirdropStart(now, { from: accounts[1] });
      // Assert
      await expectRevert(start_promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should allow airdrop start to be pushed a bit to the future", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(now));
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      await initialAirdrop.setAirdropStart(later);
      // Assert
      const initialAirdropStartTs2 = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs2.eq(later));
    });

    it("Should not allow airdrop start to be pushed over latest start timestamp", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      const latestAirdropStartTs = await initialAirdrop.latestAirdropStartTs();
      // Act
      const later = latestAirdropStartTs.addn(1);
      const start_promise = initialAirdrop.setAirdropStart(later);
      // Assert
      await expectRevert(start_promise, ERR_WRONG_START_TIMESTAMP);
    });

    it("Should not allow airdrop start to be pushed before current start timestamp", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      // Act
      const later = now.subn(1);
      const start_promise = initialAirdrop.setAirdropStart(later);
      // Assert
      await expectRevert(start_promise, ERR_WRONG_START_TIMESTAMP);
    });

    it("Should not allow airdrop start to be changed if distribution already started", async () => {
      // Assemble
      await bestowClaimableBalance(BN(1500));
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(now));
      await initialAirdrop.transferAirdrop();
      // Act
      const later = now.addn(60 * 60 * 24 * 5);
      const start_promise = initialAirdrop.setAirdropStart(later);
      // Assert
      await expectRevert(start_promise, ERR_ALREADY_STARTED);
    });
  });

  describe("airdrop transfer", async () => {
    beforeEach(async () => {
      // Build an array of claimant accounts
      claimants = [];
      for (let i = 0; i < 150; i++) {
        claimants[i] = await getAddressWithZeroBalance();
      }
      await bulkLoad(BN(1000));
    });

    it("Should transfer airdrop to the first 100 accounts", async () => {
      // Assemble
      await bestowClaimableBalance(BN(150 * 150));
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(now));
      // Act
      await initialAirdrop.transferAirdrop();
      // Assert
      for (let i = 0; i < 100; i++) {
        assert.equal(await initialAirdrop.airdropAccounts(i), constants.ZERO_ADDRESS);
        assert.equal((await initialAirdrop.airdropAmountsWei(claimants[i])).toString(), "0");
        assert.equal(await web3.eth.getBalance(claimants[i]), "150");
      }
      for (let i = 100; i < 150; i++) {
        assert.equal(await initialAirdrop.airdropAccounts(i), claimants[i]);
        assert.equal((await initialAirdrop.airdropAmountsWei(claimants[i])).toString(), "150");
        assert.equal(await web3.eth.getBalance(claimants[i]), "0");
      }
      assert((await initialAirdrop.totalTransferredAirdropWei()).eqn(100 * 150));
      assert((await initialAirdrop.nextAirdropAccountIndexToTransfer()).eqn(100));
    });

    it("Should transfer airdrop - from any account", async () => {
      // Assemble
      await bestowClaimableBalance(BN(150 * 150));
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(now));
      // Act
      await initialAirdrop.transferAirdrop({from: accounts[5]});
      await initialAirdrop.transferAirdrop({from: accounts[12]});
      // Assert
      for (let i = 0; i < 150; i++) {
        assert.equal(await initialAirdrop.airdropAccounts(i), constants.ZERO_ADDRESS);
        assert.equal((await initialAirdrop.airdropAmountsWei(claimants[i])).toString(), "0");
        assert.equal(await web3.eth.getBalance(claimants[i]), "150");
      }
      assert((await initialAirdrop.totalTransferredAirdropWei()).eqn(150 * 150));
      assert((await initialAirdrop.nextAirdropAccountIndexToTransfer()).eqn(150));
    });

    it("Should skip transfering airdrop to the account if error happens", async () => {
      // Assemble
      const additionalClimants: string[] = [];
      const gasConsumer = await GasConsumer.new();
      additionalClimants.push(gasConsumer.address);
      claimants.push(gasConsumer.address);
      for (let i = 0; i < 9; i++) {
        const address = await getAddressWithZeroBalance();
        additionalClimants.push(address);
        claimants.push(address);
      }
      await bulkLoad(BN(1000), additionalClimants);
      await bestowClaimableBalance(BN(160 * 150));
      const now = await time.latest();
      await initialAirdrop.setAirdropStart(now);
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(now));
      // Act
      await initialAirdrop.transferAirdrop();
      const tx = await initialAirdrop.transferAirdrop();
      // Assert
      for (let i = 0; i < 160; i++) {
        assert.equal(await initialAirdrop.airdropAccounts(i), constants.ZERO_ADDRESS);
        assert.equal((await initialAirdrop.airdropAmountsWei(claimants[i])).toString(), "0");
        assert.equal(await web3.eth.getBalance(claimants[i]), i == 150 ? "0" : "150");
      }
      assert((await initialAirdrop.totalTransferredAirdropWei()).eqn(160 * 150));
      assert((await initialAirdrop.nextAirdropAccountIndexToTransfer()).eqn(160));
      expectEvent(tx, "AirdropTransferFailure", {account: gasConsumer.address, amountWei: BN(150)});
    });

    it("Should not transfer airdrop if start not set", async () => {
      // Assemble
      await bestowClaimableBalance(BN(150 * 150));
      // Act
      const transfer_promise = initialAirdrop.transferAirdrop();
      // Assert
      await expectRevert(transfer_promise, ERR_NOT_STARTED);
    });

    it("Should not transfer airdrop if called too soon", async () => {
      // Assemble
      await bestowClaimableBalance(BN(150 * 150));
      const later = (await time.latest()).addn(100);
      await initialAirdrop.setAirdropStart(later);
      const initialAirdropStartTs = await initialAirdrop.initialAirdropStartTs();
      assert(initialAirdropStartTs.eq(later));
      // Act
      const transfer_promise = initialAirdrop.transferAirdrop();
      // Assert
      await expectRevert(transfer_promise, ERR_NOT_STARTED);
    });
  });

});
