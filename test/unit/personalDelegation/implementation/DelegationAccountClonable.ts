import { Address } from 'hardhat-deploy/dist/types';
import {
  WNatInstance,
  MockContractInstance,
  DelegationAccountManagerInstance,
  DelegationAccountClonableInstance,
  DistributionInstance,
  FtsoManagerMockInstance,
  InflationMockInstance,
  FtsoRewardManagerInstance,
  FtsoManagerInstance,
  FtsoManagerMockContract,
  FtsoRewardManagerContract,
  FtsoManagerContract,
  DistributionTreasuryInstance,
  GovernanceVotePowerInstance
} from "../../../../typechain-truffle";
import { toBN, encodeContractNames } from '../../../utils/test-helpers';
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { expectRevert, expectEvent, time, constants } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import { GOVERNANCE_GENESIS_ADDRESS } from '../../../utils/constants';

let wNat: WNatInstance;
let governanceVP: GovernanceVotePowerInstance;
let delegationAccountManager: DelegationAccountManagerInstance;
let delegationAccountClonable1: DelegationAccountClonableInstance;
let delAcc1Address: Address;
let libraryContract: DelegationAccountClonableInstance;
let delAcc2Address: Address;
let delegationAccountClonable2: DelegationAccountClonableInstance;
let distribution: DistributionInstance;
let distributionTreasury: DistributionTreasuryInstance;

let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let mockInflation: InflationMockInstance;
let mockSupply: MockContractInstance;
let ADDRESS_UPDATER: string;

const getTestFile = require('../../../utils/constants').getTestFile;

const WNat = artifacts.require("WNat");
const MockContract = artifacts.require("MockContract");
const DelegationAccountManager = artifacts.require("DelegationAccountManager");
const DelegationAccountClonable = artifacts.require("DelegationAccountClonable");
const DistributionTreasury = artifacts.require("DistributionTreasury");
const Distribution = artifacts.require("Distribution");
const SuicidalMock = artifacts.require("SuicidalMock");
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const InflationMock = artifacts.require("InflationMock");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

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


contract(`DelegationAccountClonable.sol; ${getTestFile(__filename)}; Delegation account unit tests`, async accounts => {

  ADDRESS_UPDATER = accounts[16];

  beforeEach(async () => {
    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    await setDefaultVPContract(wNat, accounts[0]);

    governanceVP = await GovernanceVotePower.new(wNat.address);
    distributionTreasury = await DistributionTreasury.new();
    await distributionTreasury.initialiseFixedAddress();
    distribution = await Distribution.new(accounts[0], distributionTreasury.address);

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
    
    // set the daily authorized inflation...this proxies call to ftso reward manager
    await mockInflation.setDailyAuthorizedInflation(2000000);
    
    // mockSuicidal = await SuicidalMock.new(ftsoRewardManager.address);

    await mockFtsoManager.setRewardManager(ftsoRewardManager.address);

    await ftsoRewardManager.activate()

    // deploy clone factory
    delegationAccountManager = await DelegationAccountManager.new(
      accounts[0],
      ADDRESS_UPDATER
    )

    await delegationAccountManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER]),
        [ADDRESS_UPDATER, wNat.address, ftsoRewardManager.address], {from: ADDRESS_UPDATER});

    // deploy library contract
    libraryContract = await DelegationAccountClonable.new();


    let create = delegationAccountManager.createDelegationAccount({ from: accounts[1] }) as any;
    await expectRevert(create, "library address is not set yet");
    
    await expectRevert(delegationAccountManager.setLibraryAddress(libraryContract.address, { from: accounts[1] }), "only governance");
    let setLibrary = await delegationAccountManager.setLibraryAddress(libraryContract.address) as any;
    expectEvent(setLibrary, "SetLibraryAddress", { libraryAddress: libraryContract.address});

    let create1 = await delegationAccountManager.createDelegationAccount({ from: accounts[1] }) as any;
    delAcc1Address = await delegationAccountManager.accountToDelegationAccount(accounts[1]);
    delegationAccountClonable1 = await DelegationAccountClonable.at(delAcc1Address);
    expect(delegationAccountClonable1.address).to.equals(delAcc1Address);
    expectEvent(create1, "CreateDelegationAccount", { delegationAccount: delAcc1Address, owner: accounts[1]} );
    // await expectEvent.inTransaction(create1.tx,  delegationAccountClonable1, "Initialize", { owner: accounts[1], ftsoRewardManager: ftsoRewardManager.address, distribution: distribution.address, governanceVP: governanceVP.address, wNat: wNat.address });

    let create2 = await delegationAccountManager.createDelegationAccount({ from: accounts[2] }) as any; 
    delAcc2Address = await delegationAccountManager.accountToDelegationAccount(accounts[2]);
    delegationAccountClonable2 = await DelegationAccountClonable.at(delAcc2Address);
    expect(delegationAccountClonable2.address).to.equals(delAcc2Address);
    expectEvent(create2, "CreateDelegationAccount", { delegationAccount: delAcc2Address, owner: accounts[2]} );
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
    expectEvent(tx, "WidthrawToOwner", { delegationAccount: delAcc1Address, amount: toBN(80) })
  });

  // it.skip("Should claim airdrop, set executor and claim again", async() => {
  //   await distribution.setClaimBalance([delAcc1Address, delAcc2Address], [1000, 1000]);

  //   const suicidalMock = await SuicidalMock.new(distributionTreasury.address);
  //   await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: 2000 });
  //   await suicidalMock.die();
  //   await distributionTreasury.setDistributionContract(distribution.address, 2000, {from: GOVERNANCE_GENESIS_ADDRESS});
    
  //   let now = await time.latest();
  //   await distribution.setEntitlementStart(now);

  //   // Time travel to next month
  //   await time.increaseTo(now.addn(86400 * 31));
  //   let claim = await delegationAccountClonable1.claimAirdropDistribution({ from: accounts[1] }) as any;
  //   await delegationAccountClonable2.claimAirdropDistribution({ from: accounts[2] });

  //   expect((await web3.eth.getBalance(delAcc1Address)).toString()).to.equals("0");
  //   expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((1000 * 3 / 100).toString());
  //   expect((await wNat.balanceOf(delAcc2Address)).toString()).to.equals((1000 * 3 / 100).toString());
  //   expectEvent(claim, "ClaimAirdrop", { delegationAccount: delAcc1Address, amount: toBN(30)});

  //   // Time travel to next month
  //   await delegationAccountClonable1.setExecutor(accounts[10], { from: accounts[1] });
  //   expect(await delegationAccountClonable1.isExecutor(accounts[10])).to.equals(true);

  //   now = await time.latest();
  //   await time.increaseTo(now.addn(86400 * 31));
  //   await delegationAccountClonable1.claimAirdropDistribution({ from: accounts[10] });
  //   expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((2 * 1000 * 3 / 100).toString());
  // });

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
    let delegates = await delegationAccountClonable1.getDelegatesOf({ from: accounts[1] }) as any;
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("10000");

    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    
    let claim = await delegationAccountClonable1.claimFtsoRewards([0], { from: accounts[1] }) as any;
    // delegationAccountClonable1 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 198).toString());
    expectEvent(claim, "ClaimFtsoRewards", { delegationAccount: delAcc1Address, rewardEpochs: [toBN(0)], amount: toBN(198)});
  });

  it("Should delegate and claim ftso rewards for two reward epochs", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40
    await delegationAccountClonable1.delegate(accounts[40], 10000, { from: accounts[1] });
    let delegates = await delegationAccountClonable1.getDelegatesOf({ from: accounts[1] }) as any;
    expect(delegates[0][0]).to.equals(accounts[40]);
    expect(delegates[1][0].toString()).to.equals("10000");

    
    await distributeRewards(accounts, startTs);
    await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
    await distributeRewards(accounts, startTs, 1, false);
    await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
    await distributeRewards(accounts, startTs, 2, false);

    let ftsoRewardManager2 = ftsoRewardManager = await FtsoRewardManager.new(
      accounts[0],
      ADDRESS_UPDATER,
      constants.ZERO_ADDRESS,
      3,
      0
    );

    await ftsoRewardManager2.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
      [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
    // await test.activate();
    // await delegationAccountManager.addFtsoRewardManager(ftsoRewardManager2.address);

    await delegationAccountManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_REWARD_MANAGER]),
      [ADDRESS_UPDATER, wNat.address, ftsoRewardManager2.address], {from: ADDRESS_UPDATER});

    // cam claim only for reward epochs 0 and 1, reward epoch 2 is not yet finalized
    let claim = await delegationAccountClonable1.claimAllFtsoRewards( { from: accounts[1] }) as any;
    // can claim Math.ceil(2000000 / 5040) + Math.ceil((2000000 - 397) / (5040 - 1)) = 794
    expect((await wNat.balanceOf(delAcc1Address)).toString()).to.equals((100 + 794).toString());
    expectEvent(claim, "ClaimFtsoRewards", { delegationAccount: delAcc1Address, rewardEpochs: [toBN(0), toBN(1)], amount: toBN(794)});
  });

  it("Should delegate and undelegate", async() => {
    // "deposit" some wnats
    await web3.eth.sendTransaction({from: accounts[1], to: delAcc1Address, value: 100 });

    // delegate some wnats to ac40 an ac50
    let delegate = await delegationAccountClonable1.delegate(accounts[40], 5000, { from: accounts[1] }) as any;
    await delegationAccountClonable1.delegate(accounts[50], 5000, { from: accounts[1] });
    expectEvent(delegate, "DelegateFtso", { delegationAccount: delAcc1Address, to: accounts[40], bips: toBN(5000) });

    let delegates = await delegationAccountClonable1.getDelegatesOf({ from: accounts[1] }) as any;
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
    let del = await delegationAccountClonable1.getDelegatesOf({ from: accounts[1] }) as any;
    expect(del[2].toString()).to.equals("0");
    expectEvent(undelegate, "UndelegateAllFtso", { delegationAccount: delAcc1Address});
  });

  it("Should revert if delegation account already exists", async() => {
    let tx = delegationAccountManager.createDelegationAccount({ from: accounts[1] });
    await expectRevert(tx, "account already has delegation account");
  })

  it("Should revert if not owner or executor", async() => {
    let tx = delegationAccountClonable1.claimFtsoRewards([0], { from: accounts[2] });
    await expectRevert(tx, "only owner or executor account");

    let tx1 = delegationAccountClonable1.delegate(accounts[40], 5000, { from: accounts[3] });
    await expectRevert(tx1, "only owner account");
  })

});