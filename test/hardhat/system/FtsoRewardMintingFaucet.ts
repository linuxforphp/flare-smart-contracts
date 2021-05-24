import { 
  FlareKeeperContract, 
  FlareKeeperInstance, 
  FtsoManagerContract, 
  FtsoManagerInstance, 
  FtsoRewardMintingFaucetContract,
  FtsoRewardMintingFaucetInstance,
  FtsoRewardManagerContract,
  FtsoRewardManagerInstance} from "../../../typechain-truffle";

import { Contracts } from "../../../scripts/Contracts";

const { expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;
const BN = web3.utils.toBN;

async function runPriceEpochsUntil(flareKeeper: FlareKeeperInstance, ftsoManager: FtsoManagerInstance, runUntilTs: BN) {
  let { 2: currentPriceEpochEndTime } = await ftsoManager.getCurrentPriceEpochData();
  while(currentPriceEpochEndTime.lt(runUntilTs)) {
    // Time travel to after price epoch end or 10 seconds after latest time
    // Get the timestamp for the just mined block
    let latest = (await time.latest()).add(BN(10));
    if (latest.gt(currentPriceEpochEndTime.add(BN(1)))) {
      await time.increaseTo(latest);
    } else {
      await time.increaseTo(currentPriceEpochEndTime.add(BN(1)));
    }
    await flareKeeper.trigger();
    currentPriceEpochEndTime = (await ftsoManager.getCurrentPriceEpochData())[2];
  }
}

/**
 * Test to see if minting faucet will topup reward manager FLR balance at next topup interval.
 */
contract(`FtsoRewardMintingFaucet.sol; ${getTestFile(__filename)}; Ftso reward minting faucet system tests`, async accounts => {
  let contracts: Contracts;
  let FlareKeeper: FlareKeeperContract;
  let flareKeeper: FlareKeeperInstance;
  let FtsoRewardMintingFaucet: FtsoRewardMintingFaucetContract;
  let ftsoRewardMintingFaucet: FtsoRewardMintingFaucetInstance;
  let RewardManager: FtsoRewardManagerContract;
  let rewardManager: FtsoRewardManagerInstance;
  let FtsoManager: FtsoManagerContract;
  let ftsoManager: FtsoManagerInstance;
  let lastFundsWithdrawTs: BN;
  let fundWithdrawTimeLockSec: BN;
  let fundRequestIntervalSec: BN;

  before(async() => {
    // Get contract addresses of deployed contracts
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);

    // Get needed contracts
    FlareKeeper = artifacts.require("FlareKeeper");
    flareKeeper = await FlareKeeper.at(contracts.getContractAddress(Contracts.FLARE_KEEPER));
    FtsoRewardMintingFaucet = artifacts.require("FtsoRewardMintingFaucet");
    ftsoRewardMintingFaucet = await FtsoRewardMintingFaucet.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MINTING_FAUCET));
    RewardManager = artifacts.require("FtsoRewardManager");
    rewardManager = await RewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    FtsoManager = artifacts.require("FtsoManager");
    ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));

    // Prime the keeper
    await flareKeeper.trigger();

    // Get the last fund withdraw timestamp
    lastFundsWithdrawTs = await ftsoRewardMintingFaucet.lastFundsWithdrawTs();
    // Get the fund withdraw time lock
    fundWithdrawTimeLockSec = await ftsoRewardMintingFaucet.fundWithdrawTimeLockSec();
    // Get the fund request JIT interval
    fundRequestIntervalSec = await ftsoRewardMintingFaucet.fundRequestIntervalSec();
  });

  it("Should mint and topup reward manager at next interval", async() => {
    // Assemble
    // Get the opening balance of the ftso reward manager
    const openingBalance = BN(await web3.eth.getBalance(rewardManager.address));
    // Now time travel to within the fund request interval
    const fundRequestToTriggerAt = lastFundsWithdrawTs.add(fundWithdrawTimeLockSec).sub(fundRequestIntervalSec).add(BN(1)); 
//    await runPriceEpochsUntil(flareKeeper, ftsoManager, fundRequestToTriggerAt);
    await time.increaseTo(fundRequestToTriggerAt);
    // Pump the keeper and get mint request
    const mintRequestReceipt = await flareKeeper.trigger();
    // Get the next topup request amount
    const nextWithdrawAmountTWei = await ftsoRewardMintingFaucet.nextWithdrawAmountTWei();
    await expectEvent(mintRequestReceipt, "MintingRequested", { toMint: nextWithdrawAmountTWei });
    // Be the fakey validator and send FLR to keeper
    await web3.eth.sendTransaction({ from: accounts[0], to: flareKeeper.address, value: nextWithdrawAmountTWei });
    // Act
    // Time travel to just past the withdraw time lock
    await time.increaseTo(lastFundsWithdrawTs.add(fundWithdrawTimeLockSec).add(BN(1)));
    // Pump the keeper; this should trigger the topup
    await flareKeeper.trigger();
    // Assert
    const closingBalance = BN(await web3.eth.getBalance(rewardManager.address));
    assert(closingBalance.sub(openingBalance).eq(nextWithdrawAmountTWei));    
  });
});
