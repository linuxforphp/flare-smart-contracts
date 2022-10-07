import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { DelegationAccountClonableInstance, DistributionToDelegatorsInstance, FtsoRewardManagerInstance, MockContractInstance } from "../../../../typechain-truffle";
import { toBN } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;

const DelegationAccountClonable = artifacts.require("DelegationAccountClonable");
const MockContract = artifacts.require("MockContract");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const DistributionToDelegators = artifacts.require("DistributionToDelegators");

const ERR_TRANSFER_FAILURE = "transfer failed";
const ERR_CLAIM_FAILURE = "unknown error when claiming";
const ERR_CLAIMED_AMOUNT_TOO_SMALL = "claimed amount too small";
const ERR_MANAGER_ONLY = "only manager";

contract(`DelegationAccountClonable.sol; ${getTestFile(__filename)}; Delegation account unit tests`, async accounts => {
  const OWNER_ADDRESS = accounts[1];
  const DELEGATION_ACCOUNT_MANAGER_ADDRESS = accounts[18];
  let delegationAccountClonable: DelegationAccountClonableInstance;
  let wNatMock: MockContractInstance;
  let ftsoRewardManagerMock: MockContractInstance;
  let distributionToDelegatorsMock: MockContractInstance;
  let ftsoRewardManagerInterface: FtsoRewardManagerInstance;
  let distributionToDelegatorsInterface: DistributionToDelegatorsInstance;

  before(async() => {
    FtsoRewardManager.link(await DataProviderFee.new() as any);
  });


  describe("Initialization", async() => {

    beforeEach(async () => {
      delegationAccountClonable = await DelegationAccountClonable.new();
      wNatMock = await MockContract.new();
    });

    it("Should initialize successfully", async() => {
      const initializeTx = await delegationAccountClonable.initialize(OWNER_ADDRESS, DELEGATION_ACCOUNT_MANAGER_ADDRESS);
      expectEvent(initializeTx, "Initialize", { owner: OWNER_ADDRESS, manager: DELEGATION_ACCOUNT_MANAGER_ADDRESS });

      let owner = await delegationAccountClonable.owner();
      expect(owner).to.equals(OWNER_ADDRESS);
    
      let manager = await delegationAccountClonable.manager();
      expect(manager).to.equals(DELEGATION_ACCOUNT_MANAGER_ADDRESS);
    });

    it("Should revert initialization if address zero", async() => {
      await expectRevert(delegationAccountClonable.initialize(constants.ZERO_ADDRESS, DELEGATION_ACCOUNT_MANAGER_ADDRESS), "owner address zero");
      await expectRevert(delegationAccountClonable.initialize(OWNER_ADDRESS, constants.ZERO_ADDRESS), "manager address zero");
    });

    it("Should not initialize twice", async() => {
      await delegationAccountClonable.initialize(OWNER_ADDRESS, DELEGATION_ACCOUNT_MANAGER_ADDRESS);
      await expectRevert(delegationAccountClonable.initialize(OWNER_ADDRESS, DELEGATION_ACCOUNT_MANAGER_ADDRESS), "owner already set");
    });

  });

  describe("Claiming", async() => {

    beforeEach(async () => {
      delegationAccountClonable = await DelegationAccountClonable.new();
      await delegationAccountClonable.initialize(OWNER_ADDRESS, DELEGATION_ACCOUNT_MANAGER_ADDRESS);
      wNatMock = await MockContract.new();
      ftsoRewardManagerMock = await MockContract.new();
      distributionToDelegatorsMock = await MockContract.new();
      ftsoRewardManagerInterface = await FtsoRewardManager.new(accounts[0], accounts[1], constants.ZERO_ADDRESS, 3, 2000);
      distributionToDelegatorsInterface = await DistributionToDelegators.new(accounts[0], accounts[1], accounts[2], accounts[3], 500, (await time.latest()).addn(10));
    });

    it("Should enable/disable claiming to delegation account", async() => {
      expect(await delegationAccountClonable.claimToDelegationAccount()).to.be.false;
      await delegationAccountClonable.enableClaimingToDelegationAccount({ from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      expect(await delegationAccountClonable.claimToDelegationAccount()).to.be.true;
      const balanceOf = web3.utils.sha3("balanceOf(address)")!.slice(0, 10); // first 4 bytes is function selector
      const transfer = web3.utils.sha3("transfer(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      await wNatMock.givenMethodReturnUint(balanceOf, 100);
      await wNatMock.givenMethodReturnBool(transfer, true);
      const tx = await delegationAccountClonable.disableClaimingToDelegationAccount(wNatMock.address, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      const invocationCountForMethod = await wNatMock.invocationCountForMethod.call(transfer);
      expect(invocationCountForMethod.toNumber()).to.be.equal(1);
      expect(await delegationAccountClonable.claimToDelegationAccount()).to.be.false;
      expectEvent(tx, "WithdrawToOwner", {delegationAccount: delegationAccountClonable.address, amount: toBN(100)});
    });

    it("Should withdraw funds", async() => {
      const transfer = web3.utils.sha3("transfer(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      await wNatMock.givenMethodReturnBool(transfer, false);
      await expectRevert(delegationAccountClonable.withdraw(wNatMock.address, 100, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS }), ERR_TRANSFER_FAILURE);
      await wNatMock.givenMethodReturnBool(transfer, true);
      const tx = await delegationAccountClonable.withdraw(wNatMock.address, 100, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      const invocationCountForMethod = await wNatMock.invocationCountForMethod.call(transfer);
      expect(invocationCountForMethod.toNumber()).to.be.equal(1);
      expectEvent(tx, "WithdrawToOwner", {delegationAccount: delegationAccountClonable.address, amount: toBN(100)});
    });

    it("Should claim ftso rewards and pay fee to executor", async() => {
      const epochs = [toBN(0), toBN(2)];
      const executor = accounts[3];
      const executorFee = toBN(20);
      await delegationAccountClonable.enableClaimingToDelegationAccount({ from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      const transfer = web3.utils.sha3("transfer(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      await wNatMock.givenMethodReturnBool(transfer, true);
      const claimDA = ftsoRewardManagerInterface.contract.methods.claim(delegationAccountClonable.address, delegationAccountClonable.address, epochs, false).encodeABI()
      const claimOwner = ftsoRewardManagerInterface.contract.methods.claim(OWNER_ADDRESS, delegationAccountClonable.address, epochs, false).encodeABI()
      await ftsoRewardManagerMock.givenCalldataReturnUint(claimDA, 10);
      await ftsoRewardManagerMock.givenCalldataReturnUint(claimOwner, 20);

      const tx = await delegationAccountClonable.claimFtsoRewards(wNatMock.address, [ftsoRewardManagerMock.address], epochs, true, true, executor, 20, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });

      const invocationCountForMethod = await wNatMock.invocationCountForMethod.call(transfer);
      expect(invocationCountForMethod.toNumber()).to.be.equal(1);
      expectEvent(tx, "ClaimFtsoRewards", {delegationAccount: delegationAccountClonable.address, amount: toBN(10), ftsoRewardManager: ftsoRewardManagerMock.address, rewardEpochs: epochs});
      expectEvent(tx, "ClaimFtsoRewards", {delegationAccount: delegationAccountClonable.address, amount: toBN(20), ftsoRewardManager: ftsoRewardManagerMock.address, rewardEpochs: epochs});
      expectEvent(tx, "ExecutorFeePaid", {delegationAccount: delegationAccountClonable.address, amount: executorFee, executor: executor});
    });

    it("Should claim airdrop distribution to delegation account and pay fee to executor", async() => {
      const month = toBN(2);
      const executor = accounts[3];
      const executorFee = toBN(20);
      await delegationAccountClonable.enableClaimingToDelegationAccount({ from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      const transfer = web3.utils.sha3("transfer(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      const claimDA = distributionToDelegatorsInterface.contract.methods.claim(delegationAccountClonable.address, month).encodeABI()
      const claimOwner = distributionToDelegatorsInterface.contract.methods.claimToPersonalDelegationAccountByExecutor(OWNER_ADDRESS, month).encodeABI()
      await distributionToDelegatorsMock.givenCalldataReturnUint(claimDA, 10);
      await distributionToDelegatorsMock.givenCalldataReturnUint(claimOwner, 20);

      await wNatMock.givenMethodReturnBool(transfer, false);
      await expectRevert(delegationAccountClonable.claimAirdropDistribution(wNatMock.address, distributionToDelegatorsMock.address, month, true, true, executor, 20, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS }), ERR_TRANSFER_FAILURE);
      await wNatMock.givenMethodReturnBool(transfer, true);
      const tx = await delegationAccountClonable.claimAirdropDistribution(wNatMock.address, distributionToDelegatorsMock.address, month, true, true, executor, 20, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });

      const invocationCountForMethod = await wNatMock.invocationCountForMethod.call(transfer);
      expect(invocationCountForMethod.toNumber()).to.be.equal(1);
      expectEvent(tx, "ClaimAirdropDistribution", {delegationAccount: delegationAccountClonable.address, amount: toBN(10), distribution: distributionToDelegatorsMock.address, month: month, claimForOwner: false});
      expectEvent(tx, "ClaimAirdropDistribution", {delegationAccount: delegationAccountClonable.address, amount: toBN(20), distribution: distributionToDelegatorsMock.address, month: month, claimForOwner: true});
      expectEvent(tx, "ExecutorFeePaid", {delegationAccount: delegationAccountClonable.address, amount: executorFee, executor: executor});
    });

    it("Should transfer airdrop distribution to owner and pay fee to executor", async() => {
      const month = toBN(2);
      const executor = accounts[3];
      const executorFee = toBN(20);
      await delegationAccountClonable.enableClaimingToDelegationAccount({ from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      const balanceOf = web3.utils.sha3("balanceOf(address)")!.slice(0, 10); // first 4 bytes is function selector
      const transfer = web3.utils.sha3("transfer(address,uint256)")!.slice(0, 10); // first 4 bytes is function selector
      await wNatMock.givenMethodReturnUint(balanceOf, 0);
      await delegationAccountClonable.disableClaimingToDelegationAccount(wNatMock.address, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      const claimOwner = distributionToDelegatorsInterface.contract.methods.claimToPersonalDelegationAccountByExecutor(OWNER_ADDRESS, month).encodeABI()
      await distributionToDelegatorsMock.givenCalldataReturnUint(claimOwner, 30);
      await wNatMock.givenMethodReturnUint(balanceOf, 10);

      await wNatMock.givenMethodReturnBool(transfer, false);
      await expectRevert(delegationAccountClonable.claimAirdropDistribution(wNatMock.address, distributionToDelegatorsMock.address, month, false, true, executor, 0, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS }), ERR_TRANSFER_FAILURE);
      await wNatMock.givenMethodReturnBool(transfer, true);
      const tx = await delegationAccountClonable.claimAirdropDistribution(wNatMock.address, distributionToDelegatorsMock.address, month, false, true, executor, 20, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });

      const invocationCountForMethod = await wNatMock.invocationCountForMethod.call(transfer);
      expect(invocationCountForMethod.toNumber()).to.be.equal(2);
      expectEvent(tx, "ClaimAirdropDistribution", {delegationAccount: delegationAccountClonable.address, amount: toBN(30), distribution: distributionToDelegatorsMock.address, month: month, claimForOwner: true});
      expectEvent(tx, "ExecutorFeePaid", {delegationAccount: delegationAccountClonable.address, amount: executorFee, executor: executor});
    });

    it("Should fail if not called by manager", async() => {
      const tx1 = delegationAccountClonable.enableClaimingToDelegationAccount();
      await expectRevert(tx1, ERR_MANAGER_ONLY);

      const tx2 = delegationAccountClonable.disableClaimingToDelegationAccount(wNatMock.address);
      await expectRevert(tx2, ERR_MANAGER_ONLY);

      const tx3 = delegationAccountClonable.claimFtsoRewards(wNatMock.address, [accounts[3]], [0], true, true, accounts[4], 0);
      await expectRevert(tx3, ERR_MANAGER_ONLY);

      const tx4 = delegationAccountClonable.claimAirdropDistribution(wNatMock.address, accounts[3], 0, true, true, accounts[4], 0);
      await expectRevert(tx4, ERR_MANAGER_ONLY);

      const tx5 = delegationAccountClonable.delegate(wNatMock.address, accounts[6], 10000);
      await expectRevert(tx5, ERR_MANAGER_ONLY);

      const tx6 = delegationAccountClonable.undelegateAll(wNatMock.address);
      await expectRevert(tx6, ERR_MANAGER_ONLY);

      const tx7 = delegationAccountClonable.revokeDelegationAt(wNatMock.address, accounts[5], 1000);
      await expectRevert(tx7, ERR_MANAGER_ONLY);

      const tx8 = delegationAccountClonable.delegateGovernance(wNatMock.address, accounts[6]);
      await expectRevert(tx8, ERR_MANAGER_ONLY);

      const tx9 = delegationAccountClonable.undelegateGovernance(wNatMock.address);
      await expectRevert(tx9, ERR_MANAGER_ONLY);

      const tx10 = delegationAccountClonable.transferExternalToken(wNatMock.address, accounts[6], 70);
      await expectRevert(tx10, ERR_MANAGER_ONLY);

      const tx11 = delegationAccountClonable.withdraw(wNatMock.address, 70);
      await expectRevert(tx11, ERR_MANAGER_ONLY);
    });

    it("Should not allow WNat transfer", async() =>{
      // Should not allow WNat transfer
      const tx = delegationAccountClonable.transferExternalToken(wNatMock.address, wNatMock.address, 70, { from: DELEGATION_ACCOUNT_MANAGER_ADDRESS });
      await expectRevert(tx, "Transfer from wNat not allowed");
    });

  });

});
