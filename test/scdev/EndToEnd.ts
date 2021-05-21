/**
 * End-to-end system test running the validator. Assumes validator is running and contracts are deployed.
 * Contract json file is to be fed in to stdin.
 */
import { 
  FlareKeeperContract, 
  FlareKeeperInstance, 
  FtsoContract, 
  FtsoInstance, 
  FtsoManagerContract, 
  FtsoManagerInstance, 
  FtsoRewardMintingFaucetContract, 
  FtsoRewardMintingFaucetInstance, 
  RewardManagerContract,
  RewardManagerInstance,
  WFLRContract,
  WFLRInstance} from "../../typechain-truffle";

import { Contracts } from "../../scripts/Contracts";
import { PriceInfo } from '../utils/PriceInfo';
import { submitPriceHash, advanceBlock } from '../utils/test-helpers';
import { spewKeeperErrors } from "../utils/FlareKeeperTestUtils";
const getTestFile = require('../utils/constants').getTestFile;
const BN = web3.utils.toBN;
var randomNumber = require("random-number-csprng");
const calcGasCost = require('../utils/eth').calcGasCost; 

async function getRandom() {
  return await randomNumber(0, 10 ** 5);
};

function preparePrice(price: number) {
  // Assume 5 decimals
  return Math.floor(price * 10 ** 5);
};

async function submitPrice(ftso: FtsoInstance, price: number, by: string): Promise<PriceInfo | undefined> {
  let epochId = ((await ftso.getCurrentEpochId()) as BN).toString();
  if (price) {
      let preparedPrice = preparePrice(price);
      let random = await getRandom();
      let hash = submitPriceHash(preparedPrice, random);

      console.log(`Submitting price ${preparedPrice} by ${by} for epoch ${epochId}`);

      await ftso.submitPrice(hash!, {from: by});

      const priceInfo = new PriceInfo(epochId, preparedPrice, random);
      priceInfo.moveToNextStatus();
      return priceInfo;
  }
};

async function revealPrice(ftso: FtsoInstance, priceInfo: PriceInfo, by: string): Promise<void> {  
  if (priceInfo?.isSubmitted()) {
    console.log(`Revealing price by ${by} of ${priceInfo.priceSubmitted} for epoch ${priceInfo.epochId}`);

    await ftso.revealPrice(priceInfo.epochId, priceInfo.priceSubmitted, priceInfo.random, { from: by });

    priceInfo.moveToNextStatus();
  }
};

function spewClaimError(account: string, e: unknown) {
  if (e instanceof Error) {
    if (e.message.includes("no rewards")) {
      console.log(`${account} has no reward to claim.`);
    } else {
      console.log(`Reward claiming failed for ${account}. Error was:`);
      console.log(e);
    }
  } else {
    console.log(`Reward claiming failed for ${account}. Error was:`);
    console.log(e);
  }
}

/**
 * @notice Utility to time travel to just past the current reward epoch.
 * @param rewardEpochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO manager contract
 * @param rewardEpochPeriod - epoch period in seconds, must match to the one set in the FTSO manager contract
 * @param rewardEpoch - current reward epoch number
 */
 async function waitTillRewardFinalizeStart(ftsoManager: FtsoManagerInstance, flareKeeper: FlareKeeperInstance, rewardEpochStartTimestamp: number, rewardEpochPeriod: number, rewardEpoch: number) {
  let finalizeTimestamp = (rewardEpoch + 1) * rewardEpochPeriod + rewardEpochStartTimestamp + 1;
  let blockInfo = await web3.eth.getBlock(await web3.eth.getBlockNumber());
  while (blockInfo.timestamp < finalizeTimestamp) {
    await new Promise(resolve => {
      setTimeout(resolve, 1000);
    });
    await advanceBlock();
    blockInfo = await web3.eth.getBlock(await web3.eth.getBlockNumber());
    console.log(`block.timestamp = ${blockInfo.timestamp}; finalizeTimestamp = ${finalizeTimestamp}; triggered at ${(await flareKeeper.systemLastTriggeredAt()).toNumber()}`);
  }
}

/**
 * Test to see if minting faucet will topup reward manager FLR balance at next topup interval.
 */
contract(`RewardManager.sol; ${getTestFile(__filename)}; Delegation, price submission, and claiming system tests`, async accounts => {
  let contracts: Contracts;
  let FlareKeeper: FlareKeeperContract;
  let flareKeeper: FlareKeeperInstance;
  let RewardManager: RewardManagerContract;
  let rewardManager: RewardManagerInstance;
  let FtsoManager: FtsoManagerContract;
  let ftsoManager: FtsoManagerInstance;
  let WFLR: WFLRContract;
  let wFLR: WFLRInstance;
  let Ftso: FtsoContract;
  let ftsoFltc: FtsoInstance;
  let ftsoFxdg: FtsoInstance;
  let ftsoFxrp: FtsoInstance;
  let ftsoWflr: FtsoInstance;
  let ftsoFdgb: FtsoInstance;
  let ftsoFada: FtsoInstance;
  let ftsoFalgo: FtsoInstance;
  let ftsoFbch: FtsoInstance;
  let FtsoRewardMintingFaucet: FtsoRewardMintingFaucetContract;
  let ftsoRewardMintingFaucet: FtsoRewardMintingFaucetInstance;
  let firstPriceEpochStartTs: BN;
  let priceEpochDurationSec: BN;
  let revealEpochDurationSec: BN;
  let rewardEpochDurationSec: BN;
  let rewardEpochsStartTs: BN;
  let d1: string;
  let p1: string;
  let p2: string;
  let p3: string;

  before(async() => {
    // Get contract addresses of deployed contracts
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);

    // Wire up needed contracts
    console.log("Setting up contract references...");
    FlareKeeper = artifacts.require("FlareKeeper");
    flareKeeper = await FlareKeeper.at(contracts.getContractAddress(Contracts.FLARE_KEEPER));
    RewardManager = artifacts.require("RewardManager");
    rewardManager = await RewardManager.at(contracts.getContractAddress(Contracts.REWARD_MANAGER));
    FtsoManager = artifacts.require("FtsoManager");
    ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    WFLR = artifacts.require("WFLR");
    wFLR = await WFLR.at(contracts.getContractAddress(Contracts.WFLR));
    Ftso = artifacts.require("Ftso");
    ftsoFltc = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_FLTC));
    ftsoFxdg = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_FXDG));
    ftsoFxrp = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_FXRP));
    ftsoWflr = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_WFLR));
    ftsoFdgb = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_FDGB));
    ftsoFada = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_FADA));
    ftsoFalgo = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_FALGO));
    ftsoFbch = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_FBCH));
    FtsoRewardMintingFaucet = artifacts.require("FtsoRewardMintingFaucet");
    ftsoRewardMintingFaucet = await FtsoRewardMintingFaucet.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MINTING_FAUCET));

    // Set the ftso epoch configuration parameters (from a random ftso) so we can time travel
    firstPriceEpochStartTs = (await ftsoWflr.getPriceEpochConfiguration())[0];
    priceEpochDurationSec = (await ftsoWflr.getPriceEpochConfiguration())[1];
    revealEpochDurationSec = (await ftsoWflr.getPriceEpochConfiguration())[2];

    // Set the ftso manager configuration parameters for time travel
    rewardEpochDurationSec = await ftsoManager.rewardEpochDurationSec();
    rewardEpochsStartTs = await ftsoManager.rewardEpochsStartTs();

    console.log("Depositing and delegating FLR...");

    // Define delegators
    d1 = accounts[1];
    // Define price providers
    p1 = accounts[2];
    p2 = accounts[3];
    p3 = accounts[4];

    // Mint some WFLR for each delegator and price provider
    const someFLR = web3.utils.toWei(BN(3000000000));
    await wFLR.deposit({from: d1, value: someFLR});
    await wFLR.deposit({from: p1, value: someFLR});
    await wFLR.deposit({from: p2, value: someFLR});
    await wFLR.deposit({from: p3, value: someFLR});    

    // Delegator delegates vote power
    await wFLR.delegate(p1, 2500, {from: d1});
    await wFLR.delegate(p2, 5000, {from: d1});
    await wFLR.delegate(p3, 2500, {from: d1});

    // Now we must wait through a reward epoch so the vote power block
    // of the next reward epoch gets set to a block that has these just
    // minted and delegated values within it. Otherwise, there will be no
    // rewards to claim.
    console.log("Waiting for a new reward epoch to start...");

    await waitTillRewardFinalizeStart(
      ftsoManager,
      flareKeeper,
      rewardEpochsStartTs.toNumber(), 
      rewardEpochDurationSec.toNumber(), 
      (await ftsoManager.getCurrentRewardEpoch()).toNumber());
  });

  it("Should delegate, price submit, reveal, earn, and claim ftso rewards", async() => {
    // Assemble
    // Providers submit prices
    const p1FlrPrice = await submitPrice(ftsoWflr, 0.35, p1);
    const p2FlrPrice = await submitPrice(ftsoWflr, 0.40, p2);
    const p3FlrPrice = await submitPrice(ftsoWflr, 0.50, p3);
    const p1XrpPrice = await submitPrice(ftsoFxrp, 1.40, p1);
    const p2XrpPrice = await submitPrice(ftsoFxrp, 1.50, p2);
    const p3XrpPrice = await submitPrice(ftsoFxrp, 1.35, p3);
    const p1LtcPrice = await submitPrice(ftsoFltc, 320, p1);
    const p2LtcPrice = await submitPrice(ftsoFltc, 340, p2);
    const p3LtcPrice = await submitPrice(ftsoFltc, 350, p3);
    const p1XdgPrice = await submitPrice(ftsoFxdg, 0.37, p1);
    const p2XdgPrice = await submitPrice(ftsoFxdg, 0.45, p2);
    const p3XdgPrice = await submitPrice(ftsoFxdg, 0.48, p3);
    const p1DgbPrice = await submitPrice(ftsoFdgb, 0.08, p1);
    const p2DgbPrice = await submitPrice(ftsoFdgb, 0.11, p2);
    const p3DgbPrice = await submitPrice(ftsoFdgb, 0.13, p3);
    const p1AdaPrice = await submitPrice(ftsoFada, 1.84, p1);
    const p2AdaPrice = await submitPrice(ftsoFada, 1.90, p2);
    const p3AdaPrice = await submitPrice(ftsoFada, 1.91, p3);
    const p1AlgoPrice = await submitPrice(ftsoFalgo, 1.00, p1);
    const p2AlgoPrice = await submitPrice(ftsoFalgo, 1.33, p2);
    const p3AlgoPrice = await submitPrice(ftsoFalgo, 1.35, p3);
    const p1BchPrice = await submitPrice(ftsoFbch, 1100, p1);
    const p2BchPrice = await submitPrice(ftsoFbch, 1203, p2);
    const p3BchPrice = await submitPrice(ftsoFbch, 1210, p3);

    const revealEndTs = (await ftsoWflr.getFullEpochReport(p1FlrPrice?.epochId!))[2];
    const revealStartTs = (await ftsoWflr.getFullEpochReport(p1FlrPrice?.epochId!))[1].add(BN(1));
    const votePowerBlock = (await ftsoWflr.getFullEpochReport(p1FlrPrice?.epochId!))[8];

    console.log(`Reveal will start at = ${revealStartTs}; Reveal will end at = ${revealEndTs}; it is now ${new Date().getTime() / 1000}; votePower block for epoch ${p1FlrPrice?.epochId!} is ${votePowerBlock.toString()}`);

    while(new Date().getTime() / 1000 < revealEndTs.toNumber()) {
      // Reveal prices
      console.log(`Trying to reveal prices; system last triggered at ${(await flareKeeper.systemLastTriggeredAt()).toNumber()}; it is now ${new Date().getTime() / 1000}...`);
      try {
        await revealPrice(ftsoWflr, p1FlrPrice!, p1);
        await revealPrice(ftsoWflr, p2FlrPrice!, p2);
        await revealPrice(ftsoWflr, p3FlrPrice!, p3);
        await revealPrice(ftsoFxrp, p1XrpPrice!, p1);
        await revealPrice(ftsoFxrp, p2XrpPrice!, p2);
        await revealPrice(ftsoFxrp, p3XrpPrice!, p3);
        await revealPrice(ftsoFltc, p1LtcPrice!, p1);
        await revealPrice(ftsoFltc, p2LtcPrice!, p2);
        await revealPrice(ftsoFltc, p3LtcPrice!, p3);
        await revealPrice(ftsoFxdg, p1XdgPrice!, p1);
        await revealPrice(ftsoFxdg, p2XdgPrice!, p2);
        await revealPrice(ftsoFxdg, p3XdgPrice!, p3);
        await revealPrice(ftsoFdgb, p1DgbPrice!, p1);
        await revealPrice(ftsoFdgb, p2DgbPrice!, p2);
        await revealPrice(ftsoFdgb, p3DgbPrice!, p3);
        await revealPrice(ftsoFada, p1AdaPrice!, p1);
        await revealPrice(ftsoFada, p2AdaPrice!, p2);
        await revealPrice(ftsoFada, p3AdaPrice!, p3);
        await revealPrice(ftsoFalgo, p1AlgoPrice!, p1);
        await revealPrice(ftsoFalgo, p2AlgoPrice!, p2);
        await revealPrice(ftsoFalgo, p3AlgoPrice!, p3);
        await revealPrice(ftsoFbch, p1BchPrice!, p1);
        await revealPrice(ftsoFbch, p2BchPrice!, p2);
        await revealPrice(ftsoFbch, p3BchPrice!, p3);
        console.log("Prices revealed.");
        await advanceBlock();
        await new Promise(resolve => {
          setTimeout(resolve, 1000);
        });
      } catch (e) {
        await advanceBlock();
        await new Promise(resolve => {
          setTimeout(resolve, 1000);
        });
      }
    }

    console.log("Waiting for reward finalization to start...");

    rewardEpochsStartTs = await ftsoManager.rewardEpochsStartTs();
    const rewardEpochId = await ftsoManager.getCurrentRewardEpoch();

    await waitTillRewardFinalizeStart(
      ftsoManager,
      flareKeeper,
      rewardEpochsStartTs.toNumber(), 
      rewardEpochDurationSec.toNumber(), 
      rewardEpochId.toNumber());

    console.log(`Claiming rewards for reward epoch ${rewardEpochId.toNumber()}...`);

    // Get the opening balances
    const p1OpeningBalance = BN(await web3.eth.getBalance(p1));
    const p2OpeningBalance = BN(await web3.eth.getBalance(p2));
    const p3OpeningBalance = BN(await web3.eth.getBalance(p3));
    
    // Act
    // By the time we get here, reward manager better have some FLR for claiming...
    const rewardManagerBalance = BN(await web3.eth.getBalance(rewardManager.address));
    console.log(`Reward manager balance = ${rewardManagerBalance.toString()}`);
    assert(rewardManagerBalance.gt(BN(0)));

    // Claim rewards
    try {
      let gasCost = BN(0);
      try {
        console.log("Claiming rewards for p1...");
        const tx = await rewardManager.claimReward(p1, rewardEpochId, { from: p1 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p1", e);
      }
      try {
        console.log("Claiming rewards for p2...");
        const tx = await rewardManager.claimReward(p2, rewardEpochId, { from: p2 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p2", e);
      }
      try {
        console.log("Claiming rewards for p3...");
        const tx = await rewardManager.claimReward(p3, rewardEpochId, { from: p3 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p3", e);
      }

      // Assert
      // Get the closing balances
      const p1ClosingBalance = BN(await web3.eth.getBalance(p1));
      const p2ClosingBalance = BN(await web3.eth.getBalance(p2));
      const p3ClosingBalance = BN(await web3.eth.getBalance(p3));

      // Compute the closing and opening balance differences, and account for gas used
      const computedRewardClaimed = 
        p1ClosingBalance.sub(p1OpeningBalance)
        .add(p2ClosingBalance).sub(p2OpeningBalance)
        .add(p3ClosingBalance).sub(p3OpeningBalance).add(gasCost);

      // Compute what we should have distributed for one price epoch
      const shouldaDistributed = (await rewardManager.dailyRewardAmountTwei()).mul(priceEpochDurationSec).div(BN(86400));
      console.log(`Should have distributed: ${shouldaDistributed.toString()}`);
      console.log(`Actually claimed: ${computedRewardClaimed.toString()}`);

      // Any keeper errors? Better spew them to the console.
      assert.equal((await spewKeeperErrors(flareKeeper, BN(0), BN(await web3.eth.getBlockNumber()))), 0);

      // After all that, one little test...
      assert(computedRewardClaimed.eq(shouldaDistributed), "Claimed amount and amount should have claimed are not equal.");
    } catch (e) {
      // Any keeper errors? Better spew them to the console and fail if so.
      assert.equal((await spewKeeperErrors(flareKeeper, BN(0), BN(await web3.eth.getBlockNumber()))), 0);
      // This is still a test failure even if no keeper errors, as something else happened.
      throw e;
    }
  });
});
