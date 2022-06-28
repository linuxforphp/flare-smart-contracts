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
import { toBN, encodeContractNames } from '../../../utils/test-helpers';
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { expectRevert, expectEvent, time, constants } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import { GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";

let wNat: WNatInstance;
let governanceVP: GovernanceVotePowerInstance;
let delegationAccountManager: DelegationAccountManagerInstance;
let delegationAccountClonable1: DelegationAccountClonableInstance;
let delAcc1Address: Address;
let libraryContract: DelegationAccountClonableInstance;
let delAcc2Address: Address;
let delegationAccountClonable2: DelegationAccountClonableInstance;
let distribution: DistributionToDelegatorsInstance;
let distributionTreasury: DistributionTreasuryInstance;

let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let mockInflation: InflationMockInstance;
let mockSupply: MockContractInstance;
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
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const InflationMock = artifacts.require("InflationMock");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const Supply = artifacts.require("Supply");
const SuicidalMock = artifacts.require("SuicidalMock");
const CloneFactoryMock = artifacts.require("CloneFactoryMock");
const ERC20Mock = artifacts.require("ERC20Mock");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const totalEntitlementWei = toBN(100000);

const CLAIM_FAILURE = "unknown error when claiming";
const UNCLAIMED_EPOCHS_FAILURE = "unknown error when claiming";

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
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
      [ADDRESS_UPDATER, mockInflation.address, deployer, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
  await ftsoRewardManager.closeExpiredRewardEpoch(rewardEpoch);
  await ftsoRewardManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
      [ADDRESS_UPDATER, mockInflation.address, currentFtsoManagerAddress, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
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
  // set distribution contract and claimable amount
  await distributionTreasury.setContracts((await MockContract.new()).address, distribution.address, {from: GOVERNANCE_GENESIS_ADDRESS});
  await distributionTreasury.selectDistributionContract(distribution.address, {from: GOVERNANCE_GENESIS_ADDRESS});
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


contract(`DelegationAccountClonable.sol; ${getTestFile(__filename)}; Delegation account unit tests`, async accounts => {
  ADDRESS_UPDATER = accounts[16];
  const GOVERNANCE_ADDRESS = accounts[0];
  INFLATION_ADDRESS = accounts[17];

  beforeEach(async () => {
    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    await setDefaultVPContract(wNat, accounts[0]);

    governanceVP = await GovernanceVotePower.new(wNat.address);
    await wNat.setGovernanceVotePower(governanceVP.address);

    wNatMock = await MockContract.new();
    priceSubmitterMock = await MockContract.new();

    distributionTreasury = await DistributionTreasury.new();
    await distributionTreasury.initialiseFixedAddress();
    distribution = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, priceSubmitterMock.address, distributionTreasury.address, totalEntitlementWei);

    supply = await Supply.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, constants.ZERO_ADDRESS, 10000000, 9000000, []);

    // ftso reward manager
    mockFtsoManager = await MockFtsoManager.new();
    mockInflation = await InflationMock.new();
    mockSupply = await MockContract.new();

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

    await ftsoRewardManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
    await ftsoRewardManager.enableClaims();
    
    // set the daily authorized inflation...this proxies call to ftso reward manager
    await mockInflation.setDailyAuthorizedInflation(2000000);
    
    await mockFtsoManager.setRewardManager(ftsoRewardManager.address);

    await ftsoRewardManager.activate()

    // deploy clone factory
    delegationAccountManager = await DelegationAccountManager.new(
      accounts[0],
      ADDRESS_UPDATER
    )

    await delegationAccountManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
        [ADDRESS_UPDATER, wNat.address, ftsoRewardManager.address, distribution.address], {from: ADDRESS_UPDATER});

    // deploy library contract
    libraryContract = await DelegationAccountClonable.new();


    let create = delegationAccountManager.createDelegationAccount({ from: accounts[1] }) as any;
    await expectRevert(create, "library address is not set yet");

    await distribution.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.SUPPLY, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, wNatMock.address, supply.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});

    await supply.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
        [ADDRESS_UPDATER, INFLATION_ADDRESS], {from: ADDRESS_UPDATER});

    await supply.addTokenPool(distribution.address, 0, {from: GOVERNANCE_ADDRESS});

    await expectRevert(delegationAccountManager.setLibraryAddress(libraryContract.address, { from: accounts[1] }), "only governance");
    let setLibrary = await delegationAccountManager.setLibraryAddress(libraryContract.address) as any;
    expectEvent(setLibrary, "SetLibraryAddress", { libraryAddress: libraryContract.address});

    let create1 = await delegationAccountManager.createDelegationAccount({ from: accounts[1] }) as any;
    delAcc1Address = await delegationAccountManager.accountToDelegationAccount(accounts[1]);
    delegationAccountClonable1 = await DelegationAccountClonable.at(delAcc1Address);
    expect(delegationAccountClonable1.address).to.equals(delAcc1Address);
    expectEvent(create1, "CreateDelegationAccount", { delegationAccount: delAcc1Address, owner: accounts[1]} );
    await expectEvent.inTransaction(create1.tx, delegationAccountClonable1, "Initialize", { owner: accounts[1], 
      manager: delegationAccountManager.address });

    let create2 = await delegationAccountManager.createDelegationAccount({ from: accounts[2] }) as any; 
    delAcc2Address = await delegationAccountManager.accountToDelegationAccount(accounts[2]);
    delegationAccountClonable2 = await DelegationAccountClonable.at(delAcc2Address);
    expect(delegationAccountClonable2.address).to.equals(delAcc2Address);
    expectEvent(create2, "CreateDelegationAccount", { delegationAccount: delAcc2Address, owner: accounts[2]} );

    let create99 = await delegationAccountManager.contract.methods.createDelegationAccount().call({ from: accounts[99] }); //return value (address) of createDelegationAccount function
    await delegationAccountManager.createDelegationAccount({ from: accounts[99] });
    let delAcc99Address = await delegationAccountManager.accountToDelegationAccount(accounts[99]);
    expect(create99).to.equals(delAcc99Address);
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
    
    let tx = await delegationAccountClonable1.withdraw(80, { from:accounts[1] }) as any;
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals("20");
    expect((await wNat.balanceOf(accounts[1])).toString()).to.equals("80");
    expectEvent(tx, "WidthrawToOwner", { delegationAccount: delAcc1Address, amount: toBN(80) });

    const mockWNAT = await MockContract.new();
    const current = wNat.contract.methods.transfer(accounts[1], 10).encodeABI();
    await mockWNAT.givenMethodReturnBool(current, false);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, mockWNAT.address, ftsoRewardManager.address, distribution.address], {from: ADDRESS_UPDATER}
    );
    let tx1 = delegationAccountClonable1.withdraw(10, { from:accounts[1] }) as any;
    await expectRevert(tx1, "transfer failed");

  });

  it("Should be able to claim 2.37% * 3 after day 90", async () => {
    await bestowClaimableBalance(totalEntitlementWei);
    // Assemble
    const days = 90;
    const addresses = [delAcc1Address, delAcc2Address, accounts[3]];
    const wNatBalances = [500, 2000, 1500];
    const numberOfBlocks = 12 * days;
    const startBlockNumber = (await time.latestBlock()).toNumber() + numberOfBlocks * (addresses.length + 1) + 1;
    await setMockBalances(startBlockNumber, numberOfBlocks, addresses, wNatBalances);
    await time.advanceBlock();
    const start = (await time.latest()).addn(1);
    await distribution.setEntitlementStart(start, { from: GOVERNANCE_ADDRESS} );
    await createSomeBlocksAndProceed(start, days);
    // Act
    const claimable = await distribution.getClaimableAmountOf(delAcc1Address, 1, { from: accounts[1] });

    const mockDistribution1 = await MockContract.new();
    const claim = distribution.contract.methods.claim(delegationAccountClonable1.address, 1).encodeABI();
    const next = distribution.contract.methods.getMonthToExpireNext().encodeABI();
    const current = distribution.contract.methods.getCurrentMonth().encodeABI();
    await mockDistribution1.givenMethodRevertWithMessage(claim, "unable to claim");
    await mockDistribution1.givenMethodReturnUint(next, 0);
    await mockDistribution1.givenMethodReturnUint(current, 2);

    const mockDistribution2 = await MockContract.new();
    await mockDistribution2.givenMethodRunOutOfGas(claim);
    await mockDistribution2.givenMethodReturnUint(next, 0);
    await mockDistribution2.givenMethodReturnUint(current, 2);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, ftsoRewardManager.address, mockDistribution1.address], {from: ADDRESS_UPDATER}
    );

      await delegationAccountManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
        [ADDRESS_UPDATER, wNat.address, ftsoRewardManager.address, mockDistribution2.address], {from: ADDRESS_UPDATER}
      );

    const claimTx = await delegationAccountClonable1.claimAirdropDistribution(1, { from: accounts[1] });
    // Assert
    expectEvent(claimTx, "ClaimDistributionFailure", { err: "unable to claim", distribution: mockDistribution1.address });
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals(claimable.toString());
    expectEvent(claimTx, "ClaimDistributionFailure", { err: CLAIM_FAILURE, distribution: mockDistribution2.address });

    const claimAllUnclaimed = await delegationAccountClonable1.claimAllUnclaimedAirdropDistribution({ from: accounts[1]});
    expectEvent(claimAllUnclaimed, "ClaimAirdrop", {delegationAccount: delAcc1Address, amount: toBN(claimable), month: toBN(0), distribution: distribution.address});
    expectEvent(claimAllUnclaimed, "ClaimAirdrop", {delegationAccount: delAcc1Address, amount: toBN(claimable), month: toBN(2), distribution: distribution.address});
    expect((await wNat.balanceOf(delAcc1Address)).toNumber()).to.equals(claimable.toNumber() * 3);

    // user already claimed for month 2
    const claimable1 = await distribution.getClaimableAmountOf(delAcc1Address, 2, { from: accounts[1] });
    expect(claimable1.toString()).to.equals("0");
    await delegationAccountClonable1.claimAirdropDistribution(2, { from: accounts[1] });
    expect((await wNat.balanceOf(delAcc1Address)).toNumber()).to.equals(claimable.toNumber() * 3);
  });

  it("Should set and remove executors", async() => {
    let tx = await delegationAccountClonable1.setExecutor(accounts[10], { from: accounts[1] }) as any;
    await delegationAccountClonable1.setExecutor(accounts[11], { from: accounts[1] });

    expect(await delegationAccountClonable1.isExecutor(accounts[10])).to.equals(true);
    expect(await delegationAccountClonable1.isExecutor(accounts[11])).to.equals(true);
    expect(await delegationAccountClonable1.isExecutor(accounts[12])).to.equals(false);
    expectEvent(tx, "SetExecutor", { delegationAccount: delAcc1Address, executor: accounts[10] });

    let remove = await delegationAccountClonable1.removeExecutor(accounts[10], { from: accounts[1] }) as any;
    expect(await delegationAccountClonable1.isExecutor(accounts[10])).to.equals(false);
    expectEvent(remove, "RemoveExecutor", { delegationAccount: delAcc1Address, executor: accounts[10] });
  });

  it("Should delegate and claim ftso reward", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40
    await delegationAccountClonable1.delegate(accounts[40], 10000, { from: accounts[1] }) as any;
    let delegates = await wNat.delegatesOf(delAcc1Address) as any;
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("10000");

    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

    // add (mock) reward manager which will revert without message
    const mockRewardManager = await MockContract.new();
    const claimReward = ftsoRewardManager.contract.methods.claimReward(delegationAccountClonable1.address, [0]).encodeABI();
    await mockRewardManager.givenMethodRunOutOfGas(claimReward);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, mockRewardManager.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(2);

    // add (mock) reward manager which will revert with message
    const mockRewardManager1 = await MockContract.new();
    const claimReward1 = ftsoRewardManager.contract.methods.claimReward(delegationAccountClonable1.address, [0]).encodeABI();
    await mockRewardManager1.givenMethodRevertWithMessage(claimReward1, "unable to claim");
    
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, mockRewardManager1.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(3);
    
    let claim = await delegationAccountClonable1.claimFtsoRewards([0], { from: accounts[1] }) as any;

    // delegationAccountClonable1 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 198).toString());

    expectEvent(claim, "ClaimFtsoRewards", { delegationAccount: delAcc1Address, rewardEpochs: [toBN(0)], amount: toBN(198), ftsoRewardManager: ftsoRewardManager.address });
    expectEvent(claim, "ClaimFtsoFailure", { err: CLAIM_FAILURE, ftsoRewardManager: mockRewardManager.address });
    expectEvent(claim, "ClaimFtsoFailure", { err: "unable to claim", ftsoRewardManager: mockRewardManager1.address });
  });

  it("Should delegate and claim ftso rewards for two reward epochs", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40
    await delegationAccountClonable1.delegate(accounts[40], 10000, { from: accounts[1] });
    let delegates = await wNat.delegatesOf(delAcc1Address) as any;
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
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
      [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
    // await ftsoRewardManager2.activate();

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, ftsoRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});

    const mockRewardManager = await MockContract.new();
    const claimReward = ftsoRewardManager.contract.methods.claimReward(delegationAccountClonable1.address, [0, 1]).encodeABI();
    await mockRewardManager.givenMethodRunOutOfGas(claimReward);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, mockRewardManager.address, distribution.address], {from: ADDRESS_UPDATER});

    // will revert with message while calling getEpochsWithUnclaimedRewards
    const mockRewardManager1 = await MockContract.new();
    const unclaimedEpochs = ftsoRewardManager.contract.methods.getEpochsWithUnclaimedRewards(delegationAccountClonable1.address).encodeABI();
    await mockRewardManager1.givenMethodRevertWithMessage(unclaimedEpochs, "cannot get unclaimed epochs");

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, mockRewardManager1.address, distribution.address], {from: ADDRESS_UPDATER});
    
    // will revert with message while calling getEpochsWithUnclaimedRewards
    const mockRewardManager2 = await MockContract.new();
    const unclaimedEpochs2 = ftsoRewardManager.contract.methods.getEpochsWithUnclaimedRewards(delegationAccountClonable1.address).encodeABI();
    await mockRewardManager2.givenMethodRunOutOfGas(unclaimedEpochs2);
     
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, mockRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});
    
    // cam claim only for reward epochs 0 and 1, reward epoch 2 is not yet finalized
    let claim = await delegationAccountClonable1.claimAllFtsoRewards( { from: accounts[1] }) as any;
    // can claim Math.ceil(2000000 / 5040) + Math.ceil((2000000 - 397) / (5040 - 1)) = 794
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 794).toString());
    expectEvent(claim, "ClaimFtsoRewards", { delegationAccount: delAcc1Address, rewardEpochs: [toBN(0), toBN(1)], amount: toBN(794), ftsoRewardManager: ftsoRewardManager.address });
    expectEvent(claim, "ClaimFtsoFailure", { err: "reward manager deactivated", ftsoRewardManager: ftsoRewardManager2.address });
    
    expectEvent(claim, "EpochsWithUnclaimedRewardsFailure", { err: "cannot get unclaimed epochs", ftsoRewardManager: mockRewardManager1.address });
    expectEvent(claim, "EpochsWithUnclaimedRewardsFailure", { err: UNCLAIMED_EPOCHS_FAILURE, ftsoRewardManager: mockRewardManager2.address });
  });


  it("Should delegate and undelegate", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40 an ac50
    let delegate = await delegationAccountClonable1.delegate(accounts[40], 5000, { from: accounts[1] }) as any;
    await delegationAccountClonable1.delegate(accounts[50], 5000, { from: accounts[1] });
    expectEvent(delegate, "DelegateFtso", { delegationAccount: delAcc1Address, to: accounts[40], bips: toBN(5000) });

    let delegates = await wNat.delegatesOf(delAcc1Address) as any;
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("5000");
    expect(delegates[0][1]).to.equals(accounts[50]);
    expect(delegates[1][1].toString()).to.equals("5000");

    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    
    await delegationAccountClonable1.claimFtsoRewards([0], { from: accounts[1] });
    // delegationAccountClonable1 claimed should be (2000000 / 5040) * (0.25 + 0.75) * 2 price epochs = 198
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 198 * 4).toString());

    //undelegate
    let undelegate = await delegationAccountClonable1.undelegateAll({ from: accounts[1] }) as any;
    let del = await wNat.delegatesOf(delAcc1Address) as any;
    expect(del[2].toString()).to.equals("0");
    expectEvent(undelegate, "UndelegateAllFtso", { delegationAccount: delAcc1Address});
  });

  it("Should revert if delegation account already exists", async() => {
    let tx = delegationAccountManager.createDelegationAccount({ from: accounts[1] });
    await expectRevert(tx, "account already has delegation account");
  });

  it("Should revert if not owner or executor", async() => {
    let tx = delegationAccountClonable1.claimFtsoRewards([0], { from: accounts[2] });
    await expectRevert(tx, "only owner or executor account");

    let tx1 = delegationAccountClonable1.delegate(accounts[40], 5000, { from: accounts[3] });
    await expectRevert(tx1, "only owner account");
  });

  it("Should delegate governance vote power", async() => {
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });
    expect((await governanceVP.getVotes(delAcc1Address)).toString()).to.equals("100");
    await wNat.deposit({ from: accounts[2], value: "20" });
    expect((await governanceVP.getVotes(accounts[2])).toString()).to.equals("20");

    let delegate = await delegationAccountClonable1.delegateGovernance(accounts[2], { from: accounts[1] }) as any;
    expectEvent(delegate, "DelegateGovernance",
     { delegationAccount: delAcc1Address, to: accounts[2], balance: toBN(100) }
    );
    expect((await governanceVP.getVotes(delAcc1Address)).toString()).to.equals("0");
    expect((await governanceVP.getVotes(accounts[2])).toString()).to.equals("120");

    expect(await governanceVP.getDelegateOfAtNow(delAcc1Address)).to.equal(accounts[2]);

    let undelegate = await delegationAccountClonable1.undelegateGovernance({ from: accounts[1] }) as any;
    expectEvent(undelegate, "UndelegateGovernance", { delegationAccount: delAcc1Address });
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
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
      [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER}
    );
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(1);

    await delegationAccountManager.getFtsoRewardManagers();
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, ftsoRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(2);
    
    // try to add ftsoRewardManager2 again
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, ftsoRewardManager2.address, distribution.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getFtsoRewardManagers()).length).to.equals(2);
  });

  it("Should not add ftso reward manager if it already exists", async() => {
    let distribution2 = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, priceSubmitterMock.address, distributionTreasury.address, totalEntitlementWei);

    await distribution2.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.SUPPLY, Contracts.DELEGATION_ACCOUNT_MANAGER]),
      [ADDRESS_UPDATER, wNatMock.address, supply.address, delegationAccountManager.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getDistributions()).length).to.equals(1);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, ftsoRewardManager.address, distribution2.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getDistributions()).length).to.equals(2);
    
    // try to add ftsoRewardManager2 again
    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER, Contracts.DISTRIBUTION_TO_DELEGATORS]),
      [ADDRESS_UPDATER, wNat.address, ftsoRewardManager.address, distribution2.address], {from: ADDRESS_UPDATER});
    expect((await delegationAccountManager.getDistributions()).length).to.equals(2);
  });

  it("Should not initialize if owner is zero address", async() => {
    let delegationAccount = await DelegationAccountClonable.new();
    let tx = delegationAccount.initialize(constants.ZERO_ADDRESS, delegationAccountManager.address);
    await expectRevert(tx, "owner address missing");
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
    tokenMock.givenMethodReturnBool(transferMethod, true)

    // Should allow transfer
    await delegationAccountClonable1.transferExternalToken(tokenMock.address, 70, {from: accounts[1]});

    // Should call exactly once
    const invocationCount = await tokenMock.invocationCountForMethod.call(transferMethod)
    assert.equal("1", invocationCount.toString())
  })

  it("Should enable transfers of ERC tokens2", async() =>{
    const token = await ERC20Mock.new("XTOK", "XToken");
    // Mint tokens
    await token.mintAmount(delegationAccountClonable1.address, 100);
    assert.equal((await token.balanceOf(delegationAccountClonable1.address)).toString(), "100");
    // Should allow transfer
    await delegationAccountClonable1.transferExternalToken(token.address, 70, {from: accounts[1]});

    assert.equal((await token.balanceOf(delegationAccountClonable1.address)).toString(), "30");
    assert.equal((await token.balanceOf(accounts[1])).toString(), "70");

  })

  it("Should not allow wnat transfer", async() =>{
    // Should not allow transfer
    const tx = delegationAccountClonable1.transferExternalToken(wNat.address, 70, {from: accounts[1]});
    await expectRevert(tx, "Transfer from wNat not allowed");
  })

  it("Should fail if calling non existing contract", async() =>{
    const tx = delegationAccountClonable1.transferExternalToken(accounts[3], 70, {from: accounts[1]});
    await expectRevert(tx, "Transaction reverted: function call to a non-contract account");
  })

  it("Should fail if calling non conforming contract", async() =>{
    const tx = delegationAccountClonable1.transferExternalToken(ftsoRewardManager.address, 70, {from: accounts[1]});
    await expectRevert(tx, "Transaction reverted: function selector was not recognized and there's no fallback function");
  })

});
