import { Address } from 'hardhat-deploy/dist/types';
import {
  WNatInstance,
  MockContractInstance,
  DelegationAccountManagerInstance,
  DelegationAccountClonableInstance,
  FtsoManagerMockInstance,
  InflationMockInstance,
  FtsoRewardManagerInstance,
  FtsoManagerInstance,
  FtsoManagerMockContract,
  FtsoRewardManagerContract,
  FtsoManagerContract,
  DistributionTreasuryInstance,
  GovernanceVotePowerInstance,
  SupplyInstance,
  DistributionToDelegatorsInstance,
  CloneFactoryMockInstance
} from "../../../../typechain-truffle";
import { toBN, encodeContractNames, compareNumberArrays, compareArrays } from '../../../utils/test-helpers';
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { expectRevert, expectEvent, time, constants } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { calcGasCost } from '../../../utils/eth';

let wNat: WNatInstance;
let governanceVP: GovernanceVotePowerInstance;
let delegationAccountManager: DelegationAccountManagerInstance;
let libraryContract: DelegationAccountClonableInstance;
let delegationAccountClonable1: DelegationAccountClonableInstance;
let delAcc1Address: Address;
let delegationAccountClonable2: DelegationAccountClonableInstance;
let delAcc2Address: Address;
let delegationAccountClonable3: DelegationAccountClonableInstance;
let delAcc3Address: Address;
let distribution: DistributionToDelegatorsInstance;
let distributionTreasury: DistributionTreasuryInstance;

let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let latestStart: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let mockInflation: InflationMockInstance;
let ADDRESS_UPDATER: string;
let priceSubmitterMock: MockContractInstance;
let supply: SupplyInstance;
let INFLATION_ADDRESS: string;
let wNatMock: MockContractInstance;
let cloneFactoryMock: CloneFactoryMockInstance;

const getTestFile = require('../../../utils/constants').getTestFile;

const WNat = artifacts.require("WNat");
const MockContract = artifacts.require("MockContract");
const DelegationAccountManager = artifacts.require("DelegationAccountManager");
const DelegationAccountClonable = artifacts.require("DelegationAccountClonable");
const DistributionTreasury = artifacts.require("DistributionTreasury");
const DistributionToDelegators = artifacts.require("DistributionToDelegators");
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const DataProviderFee = artifacts.require("DataProviderFee" as any);
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const FtsoManagement = artifacts.require("FtsoManagement");
const InflationMock = artifacts.require("InflationMock");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const Supply = artifacts.require("Supply");
const SuicidalMock = artifacts.require("SuicidalMock");
const CloneFactoryMock = artifacts.require("CloneFactoryMock");
const ERC20Mock = artifacts.require("ERC20Mock");
const SetClaimExecutorsMock = artifacts.require("SetClaimExecutorsMock");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const totalEntitlementWei = toBN(100000);

const CLAIM_FAILURE = "unknown error when claiming";
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

export async function distributeRewards(
  accounts: Truffle.Accounts,
  startTs: BN,
  currentRewardEpoch: number = 0,
  sendNats: boolean = true
) {
  let votePowerBlock = await web3.eth.getBlockNumber();
  // Assemble
  if (sendNats) {
      // give reward manager some nat to distribute...proxied through mock inflation
      await mockInflation.receiveInflation({ value: "2000000" });
  }

  // Price epochs remaining is 5040 (7 days worth at 2 minute price epochs)

  // Trigger price epoch finalization
  await mockFtsoManager.distributeRewardsCall(
      [accounts[40], accounts[50]],
      [25, 75],
      100,
      0,
      accounts[6],
      PRICE_EPOCH_DURATION_S,
      currentRewardEpoch,
      startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + PRICE_EPOCH_DURATION_S - 1),
      votePowerBlock
  );

  await time.increaseTo((await time.latest()).addn(PRICE_EPOCH_DURATION_S));

  // Let's do another price epoch
  await mockFtsoManager.distributeRewardsCall(
      [accounts[40], accounts[50]],
      [25, 75],
      100,
      1,
      accounts[6],
      PRICE_EPOCH_DURATION_S,
      currentRewardEpoch,
      startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + (PRICE_EPOCH_DURATION_S * 2) - 1),
      votePowerBlock
  );

  const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(currentRewardEpoch).encodeABI();
  const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
  await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
}

export async function expireRewardEpoch(rewardEpoch: number, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string) {
  let currentFtsoManagerAddress = await ftsoRewardManager.ftsoManager();
  await ftsoRewardManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, mockInflation.address, deployer, wNat.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});
  await ftsoRewardManager.closeExpiredRewardEpoch(rewardEpoch);
  await ftsoRewardManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, mockInflation.address, currentFtsoManagerAddress, wNat.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});
}

export async function travelToAndSetNewRewardEpoch(newRewardEpoch: number, startTs: BN, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string, closeAsYouGo = false) {
  // What reward epoch are we on based on current block time, given our startTs?
  const currentRewardEpoch = (await time.latest()).sub(startTs).div(toBN(REWARD_EPOCH_DURATION_S)).toNumber();
  for (let rewardEpoch = currentRewardEpoch; rewardEpoch < newRewardEpoch; rewardEpoch++) {
      // Time travel through each daily cycle as we work our way through to the next
      // reward epoch.
      for (let dailyCycle = 0; dailyCycle < (REWARD_EPOCH_DURATION_S / 86400); dailyCycle++) {
          try {
              await time.increaseTo(startTs.addn((rewardEpoch * REWARD_EPOCH_DURATION_S) + (dailyCycle * 86400)));
              await mockInflation.setDailyAuthorizedInflation(2000000);
          } catch (e) {
              if (e instanceof Error && e.message.includes("to a moment in the past")) {
                  // Assume that if this is being done in the past, then it does not need to be done again.
                  // So just skip.          
              } else {
                  throw e;
              }
          }
      }
      // Travel to reach next reward epoch
      await time.increaseTo(startTs.addn((rewardEpoch + 1) * REWARD_EPOCH_DURATION_S + 1));
      // workaround for modifiers due to mock
      if (closeAsYouGo) {
          await expireRewardEpoch(rewardEpoch, ftsoRewardManager, deployer);            
      }
      await mockInflation.setDailyAuthorizedInflation(2000000);
  }
  // Fake Trigger reward epoch finalization
  const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
  const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter('uint256', newRewardEpoch);
  await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
}

async function bestowClaimableBalance(balance: BN) {
  // Give the distribution contract the native token required to be in balance with entitlements
  // Our subversive attacker will be suiciding some native token into flareDaemon
  const suicidalMock = await SuicidalMock.new(distributionTreasury.address);
  // Give suicidal some native token
  await web3.eth.sendTransaction({ from: GOVERNANCE_GENESIS_ADDRESS, to: suicidalMock.address, value: balance });
  // Attacker dies
  await suicidalMock.die();
}

async function setMockBalances(startBlockNumber: number, numberOfBlocks: number, addresses: string[], wNatBalances: number[]) {
  const len = addresses.length;
  assert(len == wNatBalances.length, "addresses length does not match wNatBalances length");

  for (let block = startBlockNumber; block < startBlockNumber + numberOfBlocks; block++) {
    let totalSupply = 0;
    for (let i = 0; i < len; i++) {
      const balanceOfAt = wNat.contract.methods.balanceOfAt(addresses[i], block).encodeABI();
      const balanceOfAtReturn = web3.eth.abi.encodeParameter('uint256', wNatBalances[i]);
      await wNatMock.givenCalldataReturn(balanceOfAt, balanceOfAtReturn);
      totalSupply += wNatBalances[i];
    }

    const totalSupplyAt = wNat.contract.methods.totalSupplyAt(block).encodeABI();
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


contract(`DelegationAccountManager.sol; ${getTestFile(__filename)}; Delegation account manager unit tests`, async accounts => {
  const EXECUTOR_MAX_FEE = "500";
  const EXECUTOR_REGISTER_FEE = "100";
  ADDRESS_UPDATER = accounts[16];
  const GOVERNANCE_ADDRESS = accounts[0];
  INFLATION_ADDRESS = accounts[17];

  before(async () => {
    FtsoManager.link(await FtsoManagement.new() as any);
    FtsoRewardManager.link(await DataProviderFee.new() as any);
  });

  beforeEach(async () => {
    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    await setDefaultVPContract(wNat, accounts[0]);

    governanceVP = await GovernanceVotePower.new(wNat.address);
    await wNat.setGovernanceVotePower(governanceVP.address);

    wNatMock = await MockContract.new();
    priceSubmitterMock = await MockContract.new();

    distributionTreasury = await DistributionTreasury.new();
    await distributionTreasury.initialiseFixedAddress();
    await bestowClaimableBalance(totalEntitlementWei);
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    distribution = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, priceSubmitterMock.address, distributionTreasury.address, totalEntitlementWei, latestStart);
    // set distribution contract
    await distributionTreasury.setContracts((await MockContract.new()).address, distribution.address, {from: GOVERNANCE_GENESIS_ADDRESS});
    // select distribution contract
    await distributionTreasury.selectDistributionContract(distribution.address, {from: GOVERNANCE_GENESIS_ADDRESS});

    supply = await Supply.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 10000000, 9000000, []);

    // ftso reward manager
    mockFtsoManager = await MockFtsoManager.new();
    mockInflation = await InflationMock.new();

    ftsoRewardManager = await FtsoRewardManager.new(
        accounts[0],
        ADDRESS_UPDATER,
        constants.ZERO_ADDRESS,
        3,
        0
    );

    await mockInflation.setInflationReceiver(ftsoRewardManager.address);

    // Get the timestamp for the just mined block
    startTs = await time.latest();

    ftsoManagerInterface = await FtsoManager.new(
        accounts[0],
        accounts[0],
        ADDRESS_UPDATER,
        accounts[7],
        constants.ZERO_ADDRESS,
        startTs,
        PRICE_EPOCH_DURATION_S,
        REVEAL_EPOCH_DURATION_S,
        startTs.addn(REVEAL_EPOCH_DURATION_S),
        REWARD_EPOCH_DURATION_S,
        VOTE_POWER_BOUNDARY_FRACTION
    );

    await setDefaultVPContract(wNat, accounts[0]);

    // deploy clone factory
    delegationAccountManager = await DelegationAccountManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      3,
      EXECUTOR_MAX_FEE,
      EXECUTOR_REGISTER_FEE
    )

    await ftsoRewardManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.DELEGATION_ACCOUNT_MANAGER]),
        [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});
    await ftsoRewardManager.enableClaims();
    
    // set the daily authorized inflation...this proxies call to ftso reward manager
    await mockInflation.setDailyAuthorizedInflation(2000000);
    
    await mockFtsoManager.setRewardManager(ftsoRewardManager.address);

    await ftsoRewardManager.activate()

    await delegationAccountManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
        [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager.address, distribution.address], {from: ADDRESS_UPDATER});

    // deploy library contract
    libraryContract = await DelegationAccountClonable.new();


    let create = delegationAccountManager.enableDelegationAccount({ from: accounts[1] });
    await expectRevert(create, "library address not set yet");

    await distribution.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.SUPPLY, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, wNatMock.address, supply.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});

    await supply.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
        [ADDRESS_UPDATER, INFLATION_ADDRESS], {from: ADDRESS_UPDATER});

    await supply.addTokenPool(distribution.address, 0, {from: GOVERNANCE_ADDRESS});

    let setLibrary = await delegationAccountManager.setLibraryAddress(libraryContract.address);
    expectEvent(setLibrary, "SetLibraryAddress", { libraryAddress: libraryContract.address});

    let create1 = await delegationAccountManager.enableDelegationAccount({ from: accounts[1] });
    delAcc1Address = await delegationAccountManager.accountToDelegationAccount(accounts[1]);
    delegationAccountClonable1 = await DelegationAccountClonable.at(delAcc1Address);
    expectEvent(create1, "DelegationAccountCreated", { delegationAccount: delAcc1Address, owner: accounts[1]} );
    await expectEvent.inTransaction(create1.tx, delegationAccountClonable1, "Initialize", { owner: accounts[1], 
      manager: delegationAccountManager.address });

    let create2 = await delegationAccountManager.enableDelegationAccount({ from: accounts[2] }); 
    delAcc2Address = await delegationAccountManager.accountToDelegationAccount(accounts[2]);
    delegationAccountClonable2 = await DelegationAccountClonable.at(delAcc2Address);
    expectEvent(create2, "DelegationAccountCreated", { delegationAccount: delAcc2Address, owner: accounts[2]} );

    let create3 = await delegationAccountManager.enableDelegationAccount({ from: accounts[3] }); 
    delAcc3Address = await delegationAccountManager.accountToDelegationAccount(accounts[3]);
    delegationAccountClonable3 = await DelegationAccountClonable.at(delAcc3Address);
    expectEvent(create3, "DelegationAccountCreated", { delegationAccount: delAcc3Address, owner: accounts[3]} );

    let da99 = await delegationAccountManager.contract.methods.setClaimExecutors([]).call({ from: accounts[99] }); //return value (address) of enableDelegationAccount function
    let create99 = await delegationAccountManager.setClaimExecutors([], { from: accounts[99] });
    let delAcc99Address = await delegationAccountManager.accountToDelegationAccount(accounts[99]);
    expectEvent(create99, "DelegationAccountCreated", { delegationAccount: da99, owner: accounts[99]} );
    expect(da99).to.equals(delAcc99Address);
  });

  it("Should revert if zero value/address", async() => {
    await expectRevert(DelegationAccountManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 0, 10, 10), "value zero");
    await expectRevert(DelegationAccountManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 10, 0, 10), "value zero");
    await expectRevert(DelegationAccountManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 10, 10, 0), "value zero");

    await expectRevert(delegationAccountManager.setMaxFeeValueWei(0, {from: GOVERNANCE_ADDRESS}), "value zero");
    await expectRevert(delegationAccountManager.setRegisterExecutorFeeValueWei(0, {from: GOVERNANCE_ADDRESS}), "value zero");
    await expectRevert(delegationAccountManager.setLibraryAddress(constants.ZERO_ADDRESS, {from: GOVERNANCE_ADDRESS}), "address zero");
  });

  it("Should update fees", async() => {
    expect((await delegationAccountManager.maxFeeValueWei()).toString()).to.be.equal(EXECUTOR_MAX_FEE);
    expect((await delegationAccountManager.registerExecutorFeeValueWei()).toString()).to.be.equal(EXECUTOR_REGISTER_FEE);
    await delegationAccountManager.setMaxFeeValueWei(10000, { from: GOVERNANCE_ADDRESS });
    await delegationAccountManager.setRegisterExecutorFeeValueWei(5000, { from: GOVERNANCE_ADDRESS });
    expect((await delegationAccountManager.maxFeeValueWei()).toString()).to.be.equal("10000");
    expect((await delegationAccountManager.registerExecutorFeeValueWei()).toString()).to.be.equal("5000");
  });

  it("Should revert if not from governance", async() => {
    await expectRevert(delegationAccountManager.setLibraryAddress(libraryContract.address, { from: accounts[1] }), "only governance");
    await expectRevert(delegationAccountManager.removeFtsoRewardManager(accounts[0], { from: accounts[1] }), "only governance");
    await expectRevert(delegationAccountManager.setMaxFeeValueWei(10, { from: accounts[1] }), "only governance");
    await expectRevert(delegationAccountManager.setRegisterExecutorFeeValueWei(10, { from: accounts[1] }), "only governance");
  });

  it("Should be correct owner address", async() => {
    let owner1 = await delegationAccountClonable1.owner();
    expect(owner1).to.equals(accounts[1]);

    let owner2 = await delegationAccountClonable2.owner();
    expect(owner2).to.equals(accounts[2]);
  });

  it("Should wrap transfered tokens and then withdraw it", async()=> {
    // console.log(await web3.eth.getBalance(accounts[1]));
    expect((await web3.eth.getBalance(delAcc1Address)).toString()).to.equals("0");
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals("0");
    
    // transfer 100 NAT to delegation account contract
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    expect((await web3.eth.getBalance(delAcc1Address)).toString()).to.equals("0");
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals("100");
    expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("0");
    
    let tx = await delegationAccountManager.withdraw(80, { from:accounts[1] });
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals("20");
    expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("80");
    await expectEvent.inTransaction(tx.tx, delegationAccountClonable1, "WithdrawToOwner", { delegationAccount: delAcc1Address, amount: toBN(80) });

    const mockWNAT = await MockContract.new();
    const current = wNat.contract.methods.transfer(accounts[1], 10).encodeABI();
    await mockWNAT.givenMethodReturnBool(current, false);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, mockWNAT.address, ftsoRewardManager.address, distribution.address], {from: ADDRESS_UPDATER}
    );
    let tx1 = delegationAccountManager.withdraw(10, { from:accounts[1] });
    await expectRevert(tx1, "transfer failed");
  });

  it("Should be able to register as executor, update fee value and unregister", async () => {
    const executor = accounts[4];
    const info1 = await delegationAccountManager.getExecutorInfo(executor);
    expect(info1[0]).to.be.false;
    expect(info1[1].toString()).to.be.equal("0");
    let changes = await delegationAccountManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], []);
    compareNumberArrays(changes[1], []);
    compareArrays(changes[2], []);

    await expectRevert(delegationAccountManager.updateExecutorFeeValue(10, {from: executor}), "not registered");
    await expectRevert(delegationAccountManager.registerExecutor(10, { from: executor, value: "1"}), "invalid executor fee value");
    await expectRevert(delegationAccountManager.registerExecutor(1000, { from: executor, value: EXECUTOR_REGISTER_FEE}), "invalid fee value");
    const register = await delegationAccountManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE});
    await expectRevert(delegationAccountManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE}), "already registered");
    expectEvent(register, "ExecutorRegistered", {executor: executor});
    expectEvent(register, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "0", feeValueWei: "10"});
    let registeredExecutors = await delegationAccountManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], [executor]);
    expect(registeredExecutors[1].toString()).to.be.equal("1");
    changes = await delegationAccountManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], []);
    compareNumberArrays(changes[1], []);
    compareArrays(changes[2], []);

    const update = await delegationAccountManager.updateExecutorFeeValue(500, {from: executor});
    expectEvent(update, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "3", feeValueWei: "500"});
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");
    const info2 = await delegationAccountManager.getExecutorInfo(executor);
    expect(info2[0]).to.be.true;
    expect(info2[1].toString()).to.be.equal("10");

    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    const update2 = await delegationAccountManager.updateExecutorFeeValue(200, {from: executor});
    expectEvent(update2, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "4", feeValueWei: "200"});
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");

    await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
    const update3 = await delegationAccountManager.updateExecutorFeeValue(300, {from: executor});
    expectEvent(update3, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "5", feeValueWei: "300"});
    const update4 = await delegationAccountManager.updateExecutorFeeValue(100, {from: executor});
    expectEvent(update4, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "5", feeValueWei: "100"});
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");
    
    changes = await delegationAccountManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], [500, 200, 100]);
    compareNumberArrays(changes[1], [3, 4, 5]);
    compareArrays(changes[2], [true, true, false]);

    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    await expectRevert(delegationAccountManager.updateExecutorFeeValue(300, {from: executor}), "fee can not be updated");

    await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
    changes = await delegationAccountManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], [200, 100]);
    compareNumberArrays(changes[1], [4, 5]);
    compareArrays(changes[2], [true, true]);
    await expectRevert(delegationAccountManager.updateExecutorFeeValue(1000, {from: executor}), "invalid fee value");
    const unregister = await delegationAccountManager.unregisterExecutor({from: executor});
    expectEvent(unregister, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "6", feeValueWei: "0"});
    expectEvent(unregister, "ExecutorUnregistered", {executor: executor, validFromRewardEpoch: "6"});
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("500");
    await expectRevert(delegationAccountManager.unregisterExecutor({from: executor}), "not registered")
    changes = await delegationAccountManager.getExecutorScheduledFeeValueChanges(executor);
    compareNumberArrays(changes[0], [200, 100, 0]);
    compareNumberArrays(changes[1], [4, 5, 6]);
    compareArrays(changes[2], [true, true, false]);
    registeredExecutors = await delegationAccountManager.getRegisteredExecutors(0, 10);
    compareArrays(registeredExecutors[0], []);
    expect(registeredExecutors[1].toString()).to.be.equal("0");
    const info3 = await delegationAccountManager.getExecutorInfo(executor);
    expect(info3[0]).to.be.false;
    expect(info3[1].toString()).to.be.equal("500");

    await expectRevert(delegationAccountManager.getExecutorFeeValue(executor, 100, {from: executor}), "invalid reward epoch");
    expect((await delegationAccountManager.getExecutorFeeValue(executor, 0)).toString()).to.be.equal("10");

    await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("200");
    
    await travelToAndSetNewRewardEpoch(5, startTs, ftsoRewardManager, accounts[0]);
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("100");
    const info4 = await delegationAccountManager.getExecutorInfo(executor);
    expect(info4[0]).to.be.false;
    expect(info4[1].toString()).to.be.equal("100");

    const burnAddressOpeningBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
    const register2 = await delegationAccountManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE});
    const burnAddressClosigBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
    expectEvent(register2, "ExecutorRegistered", {executor: executor});
    expectEvent(register2, "ClaimExecutorFeeValueChanged", {executor: executor, validFromRewardEpoch: "8", feeValueWei: "10"});
    expect(burnAddressClosigBalance.sub(burnAddressOpeningBalance).toString()).to.be.equal(EXECUTOR_REGISTER_FEE);

    await travelToAndSetNewRewardEpoch(6, startTs, ftsoRewardManager, accounts[0]);
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("0");
    const info5 = await delegationAccountManager.getExecutorInfo(executor);
    expect(info5[0]).to.be.true;
    expect(info5[1].toString()).to.be.equal("0");

    await travelToAndSetNewRewardEpoch(7, startTs, ftsoRewardManager, accounts[0]);
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("0");

    await travelToAndSetNewRewardEpoch(8, startTs, ftsoRewardManager, accounts[0]);
    expect((await delegationAccountManager.getExecutorCurrentFeeValue(executor)).toString()).to.be.equal("10");
    const info6 = await delegationAccountManager.getExecutorInfo(executor);
    expect(info6[0]).to.be.true;
    expect(info6[1].toString()).to.be.equal("10");
  });

  it("Should be able to set and remove executors", async () => {
    const tx = await delegationAccountManager.setClaimExecutors([accounts[5], accounts[6]], { from: accounts[1] });
    expectEvent(tx, "ClaimExecutorsChanged", {owner: accounts[1], executors: [accounts[5], accounts[6]]});
    compareArrays(await delegationAccountManager.claimExecutors(accounts[1]), [accounts[5], accounts[6]]);

    const tx2 = await delegationAccountManager.setClaimExecutors([accounts[5]], { from: accounts[1], value: "100" });
    expectEvent(tx2, "ClaimExecutorsChanged", {owner: accounts[1], executors: [accounts[5]]});
    compareArrays(await delegationAccountManager.claimExecutors(accounts[1]), [accounts[5]]);

    await delegationAccountManager.registerExecutor(10, { value: EXECUTOR_REGISTER_FEE, from: accounts[6] });

    const setClaimExecutorsMock = await SetClaimExecutorsMock.new(delegationAccountManager.address);
    await expectRevert(setClaimExecutorsMock.setClaimExecutors([accounts[6]], { from: accounts[1], value: "100" }), "transfer failed")

    // transfer some funds to delegation account manager
    const suicidalMock = await SuicidalMock.new(delegationAccountManager.address);
    await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: 100 });
    await suicidalMock.die();

    await expectRevert(delegationAccountManager.setClaimExecutors([accounts[6]], { from: accounts[1] }), "invalid executor fee value");
    expect((await wNat.balanceOf(accounts[6])).toString()).to.be.equal("0");
    const openingBalance = toBN(await web3.eth.getBalance(accounts[1]));
    const tx3 = await delegationAccountManager.setClaimExecutors([accounts[6]], { from: accounts[1], value: "100" });
    const closingBalance = toBN(await web3.eth.getBalance(accounts[1]));
    expectEvent(tx3, "ClaimExecutorsChanged", {owner: accounts[1], executors: [accounts[6]]});
    compareArrays(await delegationAccountManager.claimExecutors(accounts[1]), [accounts[6]]);
    expect((await wNat.balanceOf(accounts[6])).toString()).to.be.equal("10");
    const gasCost = await calcGasCost(tx3);
    expect(openingBalance.sub(closingBalance).sub(gasCost).toString()).to.be.equal("10");

    const tx4 = await delegationAccountManager.setClaimExecutors([], { from: accounts[1] });
    expectEvent(tx4, "ClaimExecutorsChanged", {owner: accounts[1], executors: []});
    compareArrays(await delegationAccountManager.claimExecutors(accounts[1]), []);
  });

  it("Should be able to claim 2.37% * 3 after day 90", async () => {
    // Assemble
    const executor = accounts[4];
    const days = 90;
    const addresses = [delAcc1Address, accounts[2], delAcc3Address, accounts[3]];
    const wNatBalances = [500, 2000, 500, 1500];
    const numberOfBlocks = 12 * days;
    const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 1;
    await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
    await time.advanceBlock();
    const start = (await time.latest()).addn(1);
    await distribution.setEntitlementStart(start, { from: GOVERNANCE_ADDRESS} );
    await createSomeBlocksAndProceed(start, days);
    await distribution.setClaimExecutors([delAcc2Address], { from: accounts[2] });
    await distribution.setClaimExecutors([delAcc3Address], { from: accounts[3] });
    await delegationAccountManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE});
    await delegationAccountManager.setClaimExecutors([executor], { from: accounts[3], value: "10" });
    // Act
    const claimableDA1 = await distribution.getClaimableAmountOf(delAcc1Address, 1, { from: accounts[1] });
    await delegationAccountManager.claimDelegationAccountAirdropDistribution([accounts[1]], 1, { from: accounts[1] });
    const claimableO2 = await distribution.getClaimableAmountOf(accounts[2], 1, { from: accounts[2] });
    await delegationAccountManager.claimOwnerAirdropDistribution([accounts[2]], 1, { from: accounts[2] });
    const claimableDA3 = await distribution.getClaimableAmountOf(delAcc3Address, 1, { from: accounts[3] });
    const claimableO3 = await distribution.getClaimableAmountOf(accounts[3], 1, { from: accounts[3] });
    await delegationAccountManager.claimAirdropDistribution([accounts[3]], 1, { from: executor });

    // Assert
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals(claimableDA1.toString());
    expect((await wNat.balanceOf(delAcc2Address)).toString()).to.equals(claimableO2.toString());
    expect((await wNat.balanceOf(delAcc3Address)).toString()).to.equals(claimableDA3.add(claimableO3).subn(10).toString());
    expect((await wNat.balanceOf(executor)).toString()).to.equals("20"); // register fee + claim fee

    const claimDA10 = await delegationAccountManager.claimDelegationAccountAirdropDistribution([accounts[1]], 0, { from: accounts[1]});
    await expectEvent.inTransaction(claimDA10.tx, delegationAccountClonable1, "ClaimAirdropDistribution", {delegationAccount: delAcc1Address, amount: toBN(claimableDA1), month: toBN(0), distribution: distribution.address, claimForOwner: false});
    const claimDA12 = await delegationAccountManager.claimDelegationAccountAirdropDistribution([accounts[1]], 2, { from: accounts[1]});
    await expectEvent.inTransaction(claimDA12.tx, delegationAccountClonable1, "ClaimAirdropDistribution", {delegationAccount: delAcc1Address, amount: toBN(claimableDA1), month: toBN(2), distribution: distribution.address, claimForOwner: false});
    expect((await wNat.balanceOf(delAcc1Address)).toNumber()).to.equals(claimableDA1.toNumber() * 3);

    const claimO20 = await delegationAccountManager.claimOwnerAirdropDistribution([accounts[2]], 0, { from: accounts[2]});
    await expectEvent.inTransaction(claimO20.tx, delegationAccountClonable2, "ClaimAirdropDistribution", {delegationAccount: delAcc2Address, amount: toBN(claimableO2), month: toBN(0), distribution: distribution.address, claimForOwner: true});
    const claimO22 = await delegationAccountManager.claimOwnerAirdropDistribution([accounts[2]], 2, { from: accounts[2]});
    await expectEvent.inTransaction(claimO22.tx, delegationAccountClonable2, "ClaimAirdropDistribution", {delegationAccount: delAcc2Address, amount: toBN(claimableO2), month: toBN(2), distribution: distribution.address, claimForOwner: true});
    expect((await wNat.balanceOf(delAcc2Address)).toNumber()).to.equals(claimableO2.toNumber() * 3);

    const claim30 = await delegationAccountManager.claimAirdropDistribution([accounts[3]], 0, { from: executor});
    await expectEvent.inTransaction(claim30.tx, delegationAccountClonable3, "ClaimAirdropDistribution", {delegationAccount: delAcc3Address, amount: toBN(claimableDA3), month: toBN(0), distribution: distribution.address, claimForOwner: false});
    await expectEvent.inTransaction(claim30.tx, delegationAccountClonable3, "ClaimAirdropDistribution", {delegationAccount: delAcc3Address, amount: toBN(claimableO3), month: toBN(0), distribution: distribution.address, claimForOwner: true});
    await expectEvent.inTransaction(claim30.tx, delegationAccountClonable3, "ExecutorFeePaid", {delegationAccount: delAcc3Address, amount: toBN(10), executor: executor});

    const claim32 = await delegationAccountManager.claimAirdropDistribution([accounts[3]], 2, { from: executor});
    await expectEvent.inTransaction(claim32.tx, delegationAccountClonable3, "ClaimAirdropDistribution", {delegationAccount: delAcc3Address, amount: toBN(claimableDA3), month: toBN(2), distribution: distribution.address, claimForOwner: false});
    await expectEvent.inTransaction(claim32.tx, delegationAccountClonable3, "ClaimAirdropDistribution", {delegationAccount: delAcc3Address, amount: toBN(claimableO3), month: toBN(2), distribution: distribution.address, claimForOwner: true});
    await expectEvent.inTransaction(claim32.tx, delegationAccountClonable3, "ExecutorFeePaid", {delegationAccount: delAcc3Address, amount: toBN(10), executor: executor});
    expect((await wNat.balanceOf(delAcc3Address)).toString()).to.equals(claimableDA3.add(claimableO3).subn(10).muln(3).toString());
    expect((await wNat.balanceOf(executor)).toString()).to.equals("40"); // register fee + 3 * claim fee

    // user already claimed for month 2
    const claimableDA12 = await distribution.getClaimableAmountOf(delAcc1Address, 2, { from: accounts[1] });
    expect(claimableDA12.toString()).to.equals("0");
    await delegationAccountManager.claimDelegationAccountAirdropDistribution([accounts[1]], 2, { from: accounts[1] });
    expect((await wNat.balanceOf(delAcc1Address)).toNumber()).to.equals(claimableDA1.toNumber() * 3);

    const claimableO22 = await distribution.getClaimableAmountOf(accounts[2], 2, { from: accounts[2] });
    expect(claimableO22.toString()).to.equals("0");
    await delegationAccountManager.claimOwnerAirdropDistribution([accounts[2]], 2, { from: accounts[2] });
    expect((await wNat.balanceOf(delAcc2Address)).toNumber()).to.equals(claimableO2.toNumber() * 3);

    const claimableDA32 = await distribution.getClaimableAmountOf(delAcc3Address, 2, { from: accounts[3] });
    expect(claimableDA32.toString()).to.equals("0");
    const claimableO32 = await distribution.getClaimableAmountOf(accounts[3], 2, { from: accounts[2] });
    expect(claimableO32.toString()).to.equals("0");
    await expectRevert(delegationAccountManager.claimAirdropDistribution([accounts[3]], 2, { from: executor }), "claimed amount too small");
    await delegationAccountManager.claimAirdropDistribution([accounts[3]], 2, { from: accounts[3] });
    expect((await wNat.balanceOf(delAcc3Address)).toString()).to.equals(claimableDA3.add(claimableO3).subn(10).muln(3).toString());
    expect((await wNat.balanceOf(executor)).toString()).to.equals("40"); // register fee + 3 * claim fee

    let claim = await delegationAccountManager.claimAirdropDistribution([accounts[10]], 0, { from: accounts[10] });
    expectEvent.notEmitted(claim, "AirdropDistributionClaimed");
  });

  it("Should emit event if there was an error while claiming from distribution", async () => {
    const mockDistribution1 = await MockContract.new();
    const claimDA = distribution.contract.methods.claim(delegationAccountClonable1.address, 1).encodeABI();
    const claimO = distribution.contract.methods.claimToPersonalDelegationAccountByExecutor(delegationAccountClonable1.address, 1).encodeABI();
    const next = distribution.contract.methods.getMonthToExpireNext().encodeABI();
    const current = distribution.contract.methods.getCurrentMonth().encodeABI();
    await mockDistribution1.givenMethodRevertWithMessage(claimDA, "unable to claim for delegation account");
    await mockDistribution1.givenMethodRevertWithMessage(claimO, "unable to claim for owner");
    await mockDistribution1.givenMethodReturnUint(next, 0);
    await mockDistribution1.givenMethodReturnUint(current, 2);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager.address, mockDistribution1.address], {from: ADDRESS_UPDATER}
    );

    const claimDATx = await delegationAccountManager.claimDelegationAccountAirdropDistribution([accounts[1]], 1, { from: accounts[1] });
    await expectEvent.inTransaction(claimDATx.tx, delegationAccountClonable1, "ClaimAirdropDistributionFailure", { err: "unable to claim for delegation account", distribution: mockDistribution1.address, claimForOwner: false });
    const claimOTx = await delegationAccountManager.claimOwnerAirdropDistribution([accounts[1]], 1, { from: accounts[1] });
    await expectEvent.inTransaction(claimOTx.tx, delegationAccountClonable1, "ClaimAirdropDistributionFailure", { err: "unable to claim for owner", distribution: mockDistribution1.address, claimForOwner: true });
  });

  it("Should emit event if there was an error while claiming from distribution 2", async () => {
    const claimDA = distribution.contract.methods.claim(delegationAccountClonable1.address, 1).encodeABI();
    const claimO = distribution.contract.methods.claimToPersonalDelegationAccountByExecutor(delegationAccountClonable1.address, 1).encodeABI();
    const next = distribution.contract.methods.getMonthToExpireNext().encodeABI();
    const current = distribution.contract.methods.getCurrentMonth().encodeABI();

    const mockDistribution2 = await MockContract.new();
    await mockDistribution2.givenMethodRunOutOfGas(claimDA);
    await mockDistribution2.givenMethodRunOutOfGas(claimO);
    await mockDistribution2.givenMethodReturnUint(next, 0);
    await mockDistribution2.givenMethodReturnUint(current, 2);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager.address, mockDistribution2.address], {from: ADDRESS_UPDATER}
    );

    const claimDATx = await delegationAccountManager.claimDelegationAccountAirdropDistribution([accounts[1]], 1, { from: accounts[1] });
    await expectEvent.inTransaction(claimDATx.tx, delegationAccountClonable1, "ClaimAirdropDistributionFailure", { err: CLAIM_FAILURE, distribution: mockDistribution2.address, claimForOwner: false });
    const claimOTx = await delegationAccountManager.claimOwnerAirdropDistribution([accounts[1]], 1, { from: accounts[1] });
    await expectEvent.inTransaction(claimOTx.tx, delegationAccountClonable1, "ClaimAirdropDistributionFailure", { err: CLAIM_FAILURE, distribution: mockDistribution2.address, claimForOwner: true });
  });

  it("Should delegate and claim ftso reward", async() => {
    const executor = accounts[4];
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    await web3.eth.sendTransaction({from: accounts[2], to: wNat.address, value: 100 });
    await web3.eth.sendTransaction({from: accounts[3], to: delAcc3Address, value: 50 });
    await web3.eth.sendTransaction({from: accounts[3], to: wNat.address, value: 150 });

    // delegate some wnats to ac40
    await delegationAccountManager.delegate(accounts[40], 10000, { from: accounts[1] });
    let delegates1 = await wNat.delegatesOf(delAcc1Address);
    expect(delegates1[0][0]).to.equals(accounts[40]);
    expect(delegates1[1][0].toString()).to.equals("10000");

    await wNat.delegate(accounts[40], 10000, { from: accounts[2] });
    let delegates2 = await wNat.delegatesOf(accounts[2]);
    expect(delegates2[0][0]).to.equals(accounts[40]);
    expect(delegates2[1][0].toString()).to.equals("10000");

    await delegationAccountManager.delegate(accounts[40], 10000, { from: accounts[3] });
    let delegates3 = await wNat.delegatesOf(delAcc3Address);
    expect(delegates3[0][0]).to.equals(accounts[40]);
    expect(delegates3[1][0].toString()).to.equals("10000");

    await wNat.delegate(accounts[40], 10000, { from: accounts[3] });
    let delegates4 = await wNat.delegatesOf(accounts[3]);
    expect(delegates4[0][0]).to.equals(accounts[40]);
    expect(delegates4[1][0].toString()).to.equals("10000");

    // set claim executors
    await ftsoRewardManager.setClaimExecutors([delAcc2Address], { from: accounts[2] });
    let executors2 = await ftsoRewardManager.claimExecutors(accounts[2]);
    expect(executors2[0]).to.equals(delAcc2Address);

    await ftsoRewardManager.setClaimExecutors([delAcc3Address], { from: accounts[3] });
    let executors3 = await ftsoRewardManager.claimExecutors(accounts[3]);
    expect(executors3[0]).to.equals(delAcc3Address);

    await delegationAccountManager.registerExecutor(10, { from: executor, value: EXECUTOR_REGISTER_FEE});
    await delegationAccountManager.setClaimExecutors([executor], { from: accounts[3], value: "10" });

    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

    // add (mock) reward manager which will revert without message
    const mockRewardManager = await MockContract.new();
    const claimReward = ftsoRewardManager.contract.methods.claim(delegationAccountClonable1.address, delegationAccountClonable1.address, [0], false).encodeABI();
    await mockRewardManager.givenMethodRunOutOfGas(claimReward);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, mockRewardManager.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(2);

    // add (mock) reward manager which will revert with message
    const mockRewardManager1 = await MockContract.new();
    const claimReward1 = ftsoRewardManager.contract.methods.claim(delegationAccountClonable1.address, delegationAccountClonable1.address, [0], false).encodeABI();
    await mockRewardManager1.givenMethodRevertWithMessage(claimReward1, "unable to claim");
    
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, mockRewardManager1.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(3);
    
    let claim1 = await delegationAccountManager.claimDelegationAccountFtsoRewards([accounts[1]], [0], { from: accounts[1] });

    // delegationAccountClonable1 claim should be (2000000 / 5040) * 0.25 * 2 price epochs / 4 = 49
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 49).toString());

    await expectEvent.inTransaction(claim1.tx, delegationAccountClonable1, "ClaimFtsoRewards", { delegationAccount: delAcc1Address, rewardEpochs: ['0'], amount: toBN(49), ftsoRewardManager: ftsoRewardManager.address, claimForOwner: false });
    await expectEvent.inTransaction(claim1.tx, delegationAccountClonable1, "ClaimFtsoRewardsFailure", { err: CLAIM_FAILURE, ftsoRewardManager: mockRewardManager.address, claimForOwner: false });
    await expectEvent.inTransaction(claim1.tx, delegationAccountClonable1, "ClaimFtsoRewardsFailure", { err: "unable to claim", ftsoRewardManager: mockRewardManager1.address, claimForOwner: false });

    let claim2 = await delegationAccountManager.claimOwnerFtsoRewards([accounts[2]], [0], { from: accounts[2] });
    // accounts[2] claim should be (2000000 / 5040) * 0.25 * 2 price epochs / 4 = 49
    expect((await wNat.balanceOf(delAcc2Address)).toString()).to.equals((49).toString());

    await expectEvent.inTransaction(claim2.tx, delegationAccountClonable2, "ClaimFtsoRewards", { delegationAccount: delAcc2Address, rewardEpochs: ['0'], amount: toBN(49), ftsoRewardManager: ftsoRewardManager.address, claimForOwner: true });
    await expectEvent.inTransaction(claim2.tx, delegationAccountClonable2, "ClaimFtsoRewardsFailure", { err: CLAIM_FAILURE, ftsoRewardManager: mockRewardManager.address, claimForOwner: true });
    await expectEvent.inTransaction(claim2.tx, delegationAccountClonable2, "ClaimFtsoRewardsFailure", { err: "unable to claim", ftsoRewardManager: mockRewardManager1.address, claimForOwner: true });

    await delegationAccountManager.removeFtsoRewardManager(mockRewardManager.address, {from: GOVERNANCE_ADDRESS} );
    await delegationAccountManager.removeFtsoRewardManager(mockRewardManager1.address, {from: GOVERNANCE_ADDRESS} );
    await expectRevert(delegationAccountManager.removeFtsoRewardManager(mockRewardManager1.address, {from: GOVERNANCE_ADDRESS} ), "not found");
    let claim3 = await delegationAccountManager.claimFtsoRewards([accounts[3]], [0], { from: executor });
    // delegationAccountClonable3 and accounts[3] claim should be (2000000 / 5040) * 0.25 * 2 price epochs - 2 * 49 = 100
    expect((await wNat.balanceOf(delAcc3Address)).toString()).to.equals((50 + 100 - 10).toString());
    expect((await wNat.balanceOf(executor)).toString()).to.equals("20"); // register fee + claim fee
    //console.log(claim3.receipt.gasUsed);

    await expectEvent.inTransaction(claim3.tx, delegationAccountClonable3, "ClaimFtsoRewards", { delegationAccount: delAcc3Address, rewardEpochs: ['0'], amount: toBN(25), ftsoRewardManager: ftsoRewardManager.address, claimForOwner: false });
    await expectEvent.inTransaction(claim3.tx, delegationAccountClonable3, "ClaimFtsoRewards", { delegationAccount: delAcc3Address, rewardEpochs: ['0'], amount: toBN(75), ftsoRewardManager: ftsoRewardManager.address, claimForOwner: true });
    await expectEvent.inTransaction(claim3.tx, delegationAccountClonable3, "ExecutorFeePaid", {delegationAccount: delAcc3Address, amount: toBN(10), executor: executor});
    await expectEvent.notEmitted.inTransaction(claim3.tx, delegationAccountClonable3, "ClaimFtsoRewardsFailure");

    let claim = await delegationAccountManager.claimFtsoRewards([accounts[10]], [0], { from: accounts[10] });
    expectEvent.notEmitted(claim, "FtsoRewardsClaimed");
  });

  it("Should delegate and claim ftso rewards for two reward epochs", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40
    await delegationAccountManager.delegate(accounts[40], 10000, { from: accounts[1] });
    let delegates = await wNat.delegatesOf(delAcc1Address);
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("10000");

    
    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    await distributeRewards(accounts, startTs, 1, false);
    await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
    await distributeRewards(accounts, startTs, 2, false);

    let ftsoRewardManager2 = await FtsoRewardManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      constants.ZERO_ADDRESS,
      3,
      0
    );

    await ftsoRewardManager2.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});
    // await ftsoRewardManager2.activate();

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});

    const mockRewardManager = await MockContract.new();
    const claimReward = ftsoRewardManager.contract.methods.claimReward(delegationAccountClonable1.address, [0, 1]).encodeABI();
    await mockRewardManager.givenMethodRunOutOfGas(claimReward);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, mockRewardManager.address, distribution.address], {from: ADDRESS_UPDATER});

    // will revert with message while calling getEpochsWithUnclaimedRewards
    const mockRewardManager1 = await MockContract.new();
    const unclaimedEpochs = ftsoRewardManager.contract.methods.getEpochsWithUnclaimedRewards(delegationAccountClonable1.address).encodeABI();
    await mockRewardManager1.givenMethodRevertWithMessage(unclaimedEpochs, "cannot get unclaimed epochs");

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, mockRewardManager1.address, distribution.address], {from: ADDRESS_UPDATER});
    
    // will revert with message while calling getEpochsWithUnclaimedRewards
    const mockRewardManager2 = await MockContract.new();
    const unclaimedEpochs2 = ftsoRewardManager.contract.methods.getEpochsWithUnclaimedRewards(delegationAccountClonable1.address).encodeABI();
    await mockRewardManager2.givenMethodRunOutOfGas(unclaimedEpochs2);
     
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, mockRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});
    
    // can claim only for reward epochs 0 and 1, reward epoch 2 is not yet finalized
    let claim = await delegationAccountManager.claimDelegationAccountFtsoRewards([accounts[1]], [0,1], { from: accounts[1] });
    // can claim Math.ceil(2000000 / 5040) + Math.ceil((2000000 - 397) / (5040 - 1)) = 794
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 794).toString());
    await expectEvent.inTransaction(claim.tx, delegationAccountClonable1, "ClaimFtsoRewards", { delegationAccount: delAcc1Address, rewardEpochs: ['0','1'], amount: toBN(794), ftsoRewardManager: ftsoRewardManager.address, claimForOwner: false });
    await expectEvent.inTransaction(claim.tx, delegationAccountClonable1, "ClaimFtsoRewardsFailure", { err: "reward manager deactivated", ftsoRewardManager: ftsoRewardManager2.address, claimForOwner: false });
  });

  it("Should enable/disable delegation account", async () => {
    const data = await delegationAccountManager.getDelegationAccountData(accounts[10]);
    expect(data[0]).to.be.equal(constants.ZERO_ADDRESS);
    expect(data[1]).to.be.false;
    
    await expectRevert(delegationAccountManager.disableDelegationAccount({ from: accounts[10] }), "no delegation account");

    const delAcc = await delegationAccountManager.enableDelegationAccount.call({ from: accounts[10] });
    const enable = await delegationAccountManager.enableDelegationAccount({ from: accounts[10] });
    expectEvent(enable, "DelegationAccountUpdated", { delegationAccount: delAcc, owner: accounts[10], enabled: true });
    const delegationAccount = await DelegationAccountClonable.at(delAcc);
    compareArrays(await delegationAccountManager.claimExecutors(accounts[10]), []);
    expect(await delegationAccount.claimToDelegationAccount()).to.be.true;
    const data1 = await delegationAccountManager.getDelegationAccountData(accounts[10]);
    expect(data1[0]).to.be.equal(delAcc);
    expect(data1[1]).to.be.true;

    await delegationAccountManager.setClaimExecutors([accounts[5]], { from: accounts[10] });
    compareArrays(await delegationAccountManager.claimExecutors(accounts[10]), [accounts[5]]);
    expect(await delegationAccount.claimToDelegationAccount()).to.be.true;
    const data2 = await delegationAccountManager.getDelegationAccountData(accounts[10]);
    expect(data2[0]).to.be.equal(delAcc);
    expect(data2[1]).to.be.true;

    const disable = await delegationAccountManager.disableDelegationAccount({ from: accounts[10] });
    expectEvent(disable, "DelegationAccountUpdated", { delegationAccount: delAcc, owner: accounts[10], enabled: false });
    compareArrays(await delegationAccountManager.claimExecutors(accounts[10]), [accounts[5]]);
    expect(await delegationAccount.claimToDelegationAccount()).to.be.false;
    const data3 = await delegationAccountManager.getDelegationAccountData(accounts[10]);
    expect(data3[0]).to.be.equal(delAcc);
    expect(data3[1]).to.be.false;

    await delegationAccountManager.setClaimExecutors([accounts[6]], { from: accounts[10] });
    expect(await delegationAccountManager.isClaimExecutor(accounts[10], accounts[5])).to.be.false;
    expect(await delegationAccountManager.isClaimExecutor(accounts[10], accounts[6])).to.be.true;
    compareArrays(await delegationAccountManager.claimExecutors(accounts[10]), [accounts[6]]);
    expect(await delegationAccount.claimToDelegationAccount()).to.be.false;
    const data4 = await delegationAccountManager.getDelegationAccountData(accounts[10]);
    expect(data4[0]).to.be.equal(delAcc);
    expect(data4[1]).to.be.false;

    await delegationAccountManager.enableDelegationAccount({ from: accounts[10] });
    compareArrays(await delegationAccountManager.claimExecutors(accounts[10]), [accounts[6]]);
    expect(await delegationAccount.claimToDelegationAccount()).to.be.true;
    const data5 = await delegationAccountManager.getDelegationAccountData(accounts[10]);
    expect(data5[0]).to.be.equal(delAcc);
    expect(data5[1]).to.be.true;
  });
  
  it("Should delegate and revoke delegation", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40 an ac50
    let delegate = await delegationAccountManager.delegate(accounts[40], 5000, { from: accounts[1] });
    await delegationAccountManager.delegate(accounts[50], 5000, { from: accounts[1] });
    await expectEvent.inTransaction(delegate.tx, delegationAccountClonable1, "DelegateFtso", { delegationAccount: delAcc1Address, to: accounts[40], bips: toBN(5000) });

    let delegates = await wNat.delegatesOf(delAcc1Address);
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("5000");
    expect(delegates[0][1]).to.equals(accounts[50]);
    expect(delegates[1][1].toString()).to.equals("5000");

    const blockNumber = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    const vpBefore = await wNat.votePowerOfAt(accounts[40], blockNumber);
    const tx = await delegationAccountManager.revokeDelegationAt(accounts[40], blockNumber, { from: accounts[1] });
    const vpAfter = await wNat.votePowerOfAt(accounts[40], blockNumber);
    await expectEvent.inTransaction(tx.tx, delegationAccountClonable1, "RevokeFtso", { delegationAccount: delAcc1Address, to: accounts[40], blockNumber: toBN(blockNumber) })

    expect(vpBefore.gtn(0)).is.true;
    expect(vpAfter.eqn(0)).is.true;
  });

  it("Should batch delegate", async() => {
    async function checkDelegations(from: string, expectDelegates: string[], expectBips: number[]) {
      const { 0: delegates, 1: bips } = await wNat.delegatesOf(from);
      compareArrays(delegates, expectDelegates);
      compareArrays(bips.map(x => Number(x)), expectBips);
    }
    async function checkDelegationsAt(from: string, expectDelegates: string[], expectBips: number[], at: number) {
      const { 0: delegates, 1: bips } = await wNat.delegatesOfAt(from, at);
      compareArrays(delegates, expectDelegates);
      compareArrays(bips.map(x => Number(x)), expectBips);
    }
    // Assemble
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    // batch delegate to empty
    const tx = await delegationAccountManager.batchDelegate([accounts[2], accounts[3]], [3000, 5000], { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await expectEvent.inTransaction(tx.tx, delegationAccountClonable1, "UndelegateAllFtso");
    await expectEvent.inTransaction(tx.tx, delegationAccountClonable1, "DelegateFtso", { delegationAccount: delAcc1Address, to: accounts[2], bips: toBN(3000) });
    await expectEvent.inTransaction(tx.tx, delegationAccountClonable1, "DelegateFtso", { delegationAccount: delAcc1Address, to: accounts[3], bips: toBN(5000) });
    await checkDelegations(delAcc1Address, [accounts[2], accounts[3]], [3000, 5000]);
    // redelegate all
    await delegationAccountManager.batchDelegate([accounts[4], accounts[5]], [2000, 4000], { from: accounts[1] });
    const blk2 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [accounts[4], accounts[5]], [2000, 4000]);
    // redelegate to one delegator
    await delegationAccountManager.batchDelegate([accounts[6]], [5000], { from: accounts[1] });
    const blk3 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [accounts[6]], [5000]);
    // undelegate via batchDelegation
    await delegationAccountManager.batchDelegate([], [], { from: accounts[1] });
    const blk4 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [], []);
    // batch delegate to empty again
    await delegationAccountManager.batchDelegate([accounts[8], accounts[9]], [1000, 2000], { from: accounts[1] });
    const blk5 = await web3.eth.getBlockNumber();
    await checkDelegations(delAcc1Address, [accounts[8], accounts[9]], [1000, 2000]);
    // historical delegations should be correct
    await checkDelegationsAt(delAcc1Address, [accounts[2], accounts[3]], [3000, 5000], blk1);
    await checkDelegationsAt(delAcc1Address, [accounts[4], accounts[5]], [2000, 4000], blk2);
    await checkDelegationsAt(delAcc1Address, [accounts[6]], [5000], blk3);
    await checkDelegationsAt(delAcc1Address, [], [], blk4);
    await checkDelegationsAt(delAcc1Address, [accounts[8], accounts[9]], [1000, 2000], blk5);
  });

  it("Should delegate and undelegate", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40 an ac50
    let delegate = await delegationAccountManager.delegate(accounts[40], 5000, { from: accounts[1] });
    await delegationAccountManager.delegate(accounts[50], 5000, { from: accounts[1] });
    await expectEvent.inTransaction(delegate.tx, delegationAccountClonable1, "DelegateFtso", { delegationAccount: delAcc1Address, to: accounts[40], bips: toBN(5000) });

    let delegates = await wNat.delegatesOf(delAcc1Address);
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("5000");
    expect(delegates[0][1]).to.equals(accounts[50]);
    expect(delegates[1][1].toString()).to.equals("5000");

    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    
    await delegationAccountManager.claimDelegationAccountFtsoRewards([accounts[1]], [0], { from: accounts[1] });
    // delegationAccountClonable1 claimed should be (2000000 / 5040) * (0.25 + 0.75) * 2 price epochs = 198
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 198 * 4).toString());

    //undelegate
    let undelegate = await delegationAccountManager.undelegateAll({ from: accounts[1] });
    let del = await wNat.delegatesOf(delAcc1Address);
    expect(del[2].toString()).to.equals("0");
    await expectEvent.inTransaction(undelegate.tx, delegationAccountClonable1, "UndelegateAllFtso", { delegationAccount: delAcc1Address});
  });

  it("Should revert if not owner or executor", async() => {
    let tx = delegationAccountManager.claimDelegationAccountFtsoRewards([accounts[1]], [0], { from: accounts[2] });
    await expectRevert(tx, "only owner or executor");

    let tx1 = delegationAccountClonable1.delegate(wNat.address, accounts[40], 5000, { from: accounts[3] });
    await expectRevert(tx1, "only manager");
  });

  it("Should delegate governance vote power", async() => {
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    expect((await governanceVP.getVotes(delAcc1Address)).toString()).to.equals("100");
    await wNat.deposit({ from: accounts[2], value: "20" });
    expect((await governanceVP.getVotes(accounts[2])).toString()).to.equals("20");

    let delegate = await delegationAccountManager.delegateGovernance(accounts[2], { from: accounts[1] });
    await expectEvent.inTransaction(delegate.tx, delegationAccountClonable1, "DelegateGovernance",
     { delegationAccount: delAcc1Address, to: accounts[2] }
    );
    expect((await governanceVP.getVotes(delAcc1Address)).toString()).to.equals("0");
    expect((await governanceVP.getVotes(accounts[2])).toString()).to.equals("120");

    expect(await governanceVP.getDelegateOfAtNow(delAcc1Address)).to.equal(accounts[2]);

    let undelegate = await delegationAccountManager.undelegateGovernance({ from: accounts[1] });
    await expectEvent.inTransaction(undelegate.tx, delegationAccountClonable1, "UndelegateGovernance", { delegationAccount: delAcc1Address });
  });

  it("Should not allow to initialize twice", async() => {
    await expectRevert(delegationAccountClonable1.initialize(accounts[8], delegationAccountManager.address),
    "owner already set");
  });

  it("Should not add ftso reward manager if it already exists", async() => {
    let ftsoRewardManager2 = await FtsoRewardManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      constants.ZERO_ADDRESS,
      3,
      0
    );

    await ftsoRewardManager2.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, delegationAccountManager.address], {from: ADDRESS_UPDATER}
    );
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(1);

    await delegationAccountManager.getFtsoRewardManagers();
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(2);
    
    // try to add ftsoRewardManager2 again
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(2);
  });

  it("Should update distribution", async() => {
    let distribution2 = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, priceSubmitterMock.address, distributionTreasury.address, totalEntitlementWei, latestStart);

    await distribution2.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.SUPPLY, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, wNatMock.address, supply.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});
    expect(await delegationAccountManager.distribution()).to.equals(distribution.address);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockFtsoManager.address, wNat.address, ftsoRewardManager.address, distribution2.address], {from: ADDRESS_UPDATER});
    expect(await delegationAccountManager.distribution()).to.equals(distribution2.address);
  });

  it("Should not initialize if owner is zero address", async() => {
    let delegationAccount = await DelegationAccountClonable.new();
    let tx = delegationAccount.initialize(constants.ZERO_ADDRESS, delegationAccountManager.address);
    await expectRevert(tx, "owner address zero");
  });

  it("Should check if contract is clone", async() => {
    cloneFactoryMock = await CloneFactoryMock.new();
    let tx = await cloneFactoryMock.isClonePublic(libraryContract.address, delegationAccountClonable1.address);
    expect(tx).to.equals(true);
  });

  it("Should enable transfers of ERC tokens", async() =>{
    const tokenMock = await MockContract.new()
    const token = await ERC20Mock.new("XTOK", "XToken");
    
    // Arguments are irrelvant
    const transferMethod = token.contract.methods.transfer(accounts[99], 0).encodeABI()
    await tokenMock.givenMethodReturnBool(transferMethod, false);
    await expectRevert(delegationAccountManager.transferExternalToken(tokenMock.address, 70, {from: accounts[1]}), "transfer failed");
    await tokenMock.givenMethodReturnBool(transferMethod, true);

    // Should allow transfer
    await delegationAccountManager.transferExternalToken(tokenMock.address, 70, {from: accounts[1]});

    // Should call exactly once
    const invocationCount = await tokenMock.invocationCountForMethod.call(transferMethod)
    assert.equal("1", invocationCount.toString())
  });

  it("Should enable transfers of ERC tokens2", async() =>{
    const token = await ERC20Mock.new("XTOK", "XToken");
    // Mint tokens
    await token.mintAmount(delegationAccountClonable1.address, 100);
    assert.equal((await token.balanceOf(delegationAccountClonable1.address)).toString(), "100");
    // Should allow transfer
    await delegationAccountManager.transferExternalToken(token.address, 70, {from: accounts[1]});

    assert.equal((await token.balanceOf(delegationAccountClonable1.address)).toString(), "30");
    assert.equal((await token.balanceOf(accounts[1])).toString(), "70");

  });

  it("Should not allow wnat transfer", async() =>{
    // Should not allow transfer
    const tx = delegationAccountManager.transferExternalToken(wNat.address, 70, {from: accounts[1]});
    await expectRevert(tx, "Transfer from wNat not allowed");
  });

  it("Should fail if calling non existing contract", async() =>{
    const tx = delegationAccountManager.transferExternalToken(accounts[3], 70, {from: accounts[1]});
    await expectRevert(tx, "Transaction reverted: function call to a non-contract account");
  });

  it("Should fail if calling non conforming contract", async() =>{
    const tx = delegationAccountManager.transferExternalToken(ftsoRewardManager.address, 70, {from: accounts[1]});
    await expectRevert(tx, "Transaction reverted: function selector was not recognized and there's no fallback function");
  });

});
