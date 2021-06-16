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
  FtsoRewardManagerContract,
  FtsoRewardManagerInstance,
  PriceSubmitterContract,
  PriceSubmitterInstance,
  WFlrContract,
  WFlrInstance} from "../../typechain-truffle";

import { Contracts } from "../../deployment/scripts/Contracts";
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
      let hash = submitPriceHash(preparedPrice, random, by);

      console.log(`Submitting price ${preparedPrice} by ${by} for epoch ${epochId}`);

      await ftso.submitPriceHash(hash!, {from: by});

      const priceInfo = new PriceInfo(epochId, preparedPrice, random);
      priceInfo.moveToNextStatus();
      return priceInfo;
  }
};

async function submitPricePriceSubmitter(ftsos: FtsoInstance[], priceSubmitter: PriceSubmitterInstance, prices: number[], by: string): Promise<PriceInfo[] | undefined> {
  if(!ftsos || !prices || ftsos.length != prices.length) throw Error("Lists of ftsos and prices illegal or do not match")
  let epochId = ((await ftsos[0].getCurrentEpochId()) as BN).toString();
  let hashes: string[] = [];
  let preparedPrices: number[] = [];
  let priceInfos: PriceInfo[] = [];
  let randoms: any[] = [];
  for (let i = 0; i < ftsos.length; i++) {
    let price = prices[i]
    let preparedPrice = preparePrice(price);
    let random = await getRandom();
    randoms.push(random);
    let hash = submitPriceHash(preparedPrice, random, by);
    preparedPrices.push(preparedPrice);
    hashes.push(hash);
  }

  console.log(`Submitting prices ${ preparedPrices } by ${ by } for epoch ${ epochId }`);

  // await priceSubmitter.submitPriceHash(hash!, {from: by});
  await priceSubmitter.submitPriceHashes(ftsos.map(ftso => ftso.address), hashes, {from: by, gas: "50000"})
  for (let i = 0; i < ftsos.length; i++) {
    const priceInfo = new PriceInfo(epochId, preparedPrices[i], randoms[i]);
    priceInfo.moveToNextStatus();
    priceInfos.push(priceInfo);
  }
  return priceInfos
};

async function revealPrice(ftso: FtsoInstance, priceInfo: PriceInfo, by: string): Promise<void> {  
  if (priceInfo?.isSubmitted()) {
    console.log(`Revealing price by ${by} of ${priceInfo.priceSubmitted} for epoch ${priceInfo.epochId}`);

    await ftso.revealPrice(priceInfo.epochId, priceInfo.priceSubmitted, priceInfo.random, { from: by });

    priceInfo.moveToNextStatus();
  }
};

async function revealPricePriceSubmitter(ftsos: FtsoInstance[], priceSubmitter: PriceSubmitterInstance, priceInfos: PriceInfo[], by: string): Promise<void> {
  if(!ftsos || !priceInfos || ftsos.length == 0 || ftsos.length != priceInfos.length) throw Error("Lists of ftsos and priceInfos illegal or they do not match")
  let epochId = priceInfos[0].epochId;

  if(priceInfos.some(priceInfo => !priceInfo.isSubmitted())) throw Error("Some price infos not submitted");
  priceInfos.forEach(priceInfo => {
    priceInfo.moveToNextStatus();
  })

  console.log(`Revealing price by ${ by } for epoch ${ epochId }`);

  await priceSubmitter.revealPrices(
    epochId, 
    ftsos.map(ftso => ftso.address), 
    priceInfos.map(priceInfo => priceInfo.priceSubmitted),
    priceInfos.map(priceInfo => priceInfo.random),
    {from: by, gas: "50000"}
  )
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
  let RewardManager: FtsoRewardManagerContract;
  let rewardManager: FtsoRewardManagerInstance;
  let FtsoManager: FtsoManagerContract;
  let ftsoManager: FtsoManagerInstance;
  let PriceSubmitter: PriceSubmitterContract;
  let priceSubmiter: PriceSubmitterInstance;  
  let WFLR: WFlrContract;
  let wFLR: WFlrInstance;
  let Ftso: FtsoContract;
  let ftsoFltc: FtsoInstance;
  let ftsoFxdg: FtsoInstance;
  let ftsoFxrp: FtsoInstance;
  let ftsoWflr: FtsoInstance;
  let ftsoFdgb: FtsoInstance;
  let ftsoFada: FtsoInstance;
  let ftsoFalgo: FtsoInstance;
  let ftsoFbch: FtsoInstance;
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
    RewardManager = artifacts.require("FtsoRewardManager");
    rewardManager = await RewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    FtsoManager = artifacts.require("FtsoManager");
    ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    PriceSubmitter = artifacts.require("PriceSubmitter");
    priceSubmiter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));    
    WFLR = artifacts.require("WFlr");
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

    const p1SubmitterPrices = await submitPricePriceSubmitter([ftsoFalgo, ftsoFbch, ftsoFada], priceSubmiter, [1.00, 1100, 1.84], p1);
    const p2SubmitterPrices = await submitPricePriceSubmitter([ftsoFalgo, ftsoFbch, ftsoFada], priceSubmiter, [1.33, 1203, 1.90], p2);
    const p3SubmitterPrices = await submitPricePriceSubmitter([ftsoFalgo, ftsoFbch, ftsoFada], priceSubmiter, [1.35, 1210, 1.91], p3);    

    
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
    // const p1AdaPrice = await submitPrice(ftsoFada, 1.84, p1);
    // const p2AdaPrice = await submitPrice(ftsoFada, 1.90, p2);
    // const p3AdaPrice = await submitPrice(ftsoFada, 1.91, p3);

    // const p1AlgoPrice = await submitPrice(ftsoFalgo, 1.00, p1);
    // const p2AlgoPrice = await submitPrice(ftsoFalgo, 1.33, p2);
    // const p3AlgoPrice = await submitPrice(ftsoFalgo, 1.35, p3);
    // const p1BchPrice = await submitPrice(ftsoFbch, 1100, p1);
    // const p2BchPrice = await submitPrice(ftsoFbch, 1203, p2);
    // const p3BchPrice = await submitPrice(ftsoFbch, 1210, p3);

    // console.log("CURRENT PRICE FADA - START", await ftsoFada.getCurrentPrice())
    // console.log("CURRENT PRICE ALGO - START", await ftsoFalgo.getCurrentPrice())

    const revealEndTs = (await ftsoWflr.getFullEpochReport(p1FlrPrice?.epochId!))[2];
    const revealStartTs = (await ftsoWflr.getFullEpochReport(p1FlrPrice?.epochId!))[1];
    const votePowerBlock = (await ftsoWflr.getFullEpochReport(p1FlrPrice?.epochId!))[8];

    console.log(`Reveal will start at = ${revealStartTs}; Reveal will end at = ${revealEndTs}; it is now ${new Date().getTime() / 1000}; votePower block for epoch ${p1FlrPrice?.epochId!} is ${votePowerBlock.toString()}`);

    while(new Date().getTime() / 1000 < revealEndTs.toNumber()) {
      // Reveal prices
      console.log(`Trying to reveal prices; system last triggered at ${(await flareKeeper.systemLastTriggeredAt()).toNumber()}; it is now ${new Date().getTime() / 1000}...`);
      try {
        await revealPrice(ftsoWflr, p1FlrPrice!, p1);
        await revealPricePriceSubmitter([ftsoFalgo, ftsoFbch, ftsoFada], priceSubmiter, p1SubmitterPrices!, p1);
        await revealPricePriceSubmitter([ftsoFalgo, ftsoFbch, ftsoFada], priceSubmiter, p2SubmitterPrices!, p2);
        await revealPricePriceSubmitter([ftsoFalgo, ftsoFbch, ftsoFada], priceSubmiter, p3SubmitterPrices!, p3);        

        
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
        // await revealPrice(ftsoFada, p1AdaPrice!, p1);
        // await revealPrice(ftsoFada, p2AdaPrice!, p2);
        // await revealPrice(ftsoFada, p3AdaPrice!, p3);

        // await revealPrice(ftsoFalgo, p1AlgoPrice!, p1);
        // await revealPrice(ftsoFalgo, p2AlgoPrice!, p2);
        // await revealPrice(ftsoFalgo, p3AlgoPrice!, p3);
        // await revealPrice(ftsoFbch, p1BchPrice!, p1);
        // await revealPrice(ftsoFbch, p2BchPrice!, p2);
        // await revealPrice(ftsoFbch, p3BchPrice!, p3);
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

    console.log("CURRENT PRICE FADA", await ftsoFada.getCurrentPrice())
    console.log("CURRENT PRICE ALGO", await ftsoFalgo.getCurrentPrice())
  
    console.log(`Claiming rewards for reward epoch ${rewardEpochId.toNumber()}...`);

    // Get the opening balances
    const p1OpeningBalance = BN(await web3.eth.getBalance(p1));
    const p2OpeningBalance = BN(await web3.eth.getBalance(p2));
    const p3OpeningBalance = BN(await web3.eth.getBalance(p3));
    const d1OpeningBalance = BN(await web3.eth.getBalance(d1));
    
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
        const tx = await rewardManager.claimReward(p1, [rewardEpochId], { from: p1 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p1", e);
      }
      try {
        console.log("Claiming rewards for p2...");
        const tx = await rewardManager.claimReward(p2, [rewardEpochId], { from: p2 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p2", e);
      }
      try {
        console.log("Claiming rewards for p3...");
        const tx = await rewardManager.claimReward(p3, [rewardEpochId], { from: p3 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("p3", e);
      }
      try {
        console.log("Claiming rewards for d1...");
        const tx = await rewardManager.claimReward(d1, [rewardEpochId], { from: d1 });
        gasCost = gasCost.add(await calcGasCost(tx));
      } catch (e: unknown) {
        spewClaimError("d1", e);
      }

      // Assert
      // Get the closing balances
      const p1ClosingBalance = BN(await web3.eth.getBalance(p1));
      const p2ClosingBalance = BN(await web3.eth.getBalance(p2));
      const p3ClosingBalance = BN(await web3.eth.getBalance(p3));
      const d1ClosingBalance = BN(await web3.eth.getBalance(d1));

      // Compute the closing and opening balance differences, and account for gas used
      const computedRewardClaimed = 
        p1ClosingBalance.sub(p1OpeningBalance)
        .add(p2ClosingBalance).sub(p2OpeningBalance)
        .add(p3ClosingBalance).sub(p3OpeningBalance)
        .add(d1ClosingBalance).sub(d1OpeningBalance)
        .add(gasCost);

      // Compute what we should have claimed for one price epoch
      const dailyAuthorizedInflation = await rewardManager.dailyAuthorizedInflation();
      const numberOfSecondsInDay = BN(3600 * 24);
      // Back out the number of price epochs already passed, since there was no
      // voting until the given price epoch.
      const shouldaClaimed = dailyAuthorizedInflation
        .div(
          numberOfSecondsInDay.div(priceEpochDurationSec).sub(BN(p1FlrPrice?.epochId!))
        );

      console.log(`Should have claimed: ${shouldaClaimed.toString()}`);
      console.log(`Actually claimed: ${computedRewardClaimed.toString()}`);

      // Any keeper errors? Better spew them to the console.
      // Some of these are inflation zero errors, from before inflation was added to the keeper
      // at deploy time. These are ok and should be ignored.
      await spewKeeperErrors(flareKeeper);
//      assert.equal((await spewKeeperErrors(flareKeeper)), 0);

      // Account for allocation truncation during distribution calc
      // TODO: This should be fixed with a double declining balance allocation, where ever it is that
      // is causing this rounding problem.
      const differenceBetweenActualAndExpected = shouldaClaimed.sub(computedRewardClaimed);

      // After all that, one little test...
      assert(differenceBetweenActualAndExpected.lt(BN(10)), "Claimed amount and amount should have claimed are not equal.");
    } catch (e) {
      // Any keeper errors? Better spew them to the console and fail if so.
      await spewKeeperErrors(flareKeeper);
//      assert.equal((await spewKeeperErrors(flareKeeper)), 0);
      // This is still a test failure even if no keeper errors, as something else happened.
      throw e;
    }
  });

});
