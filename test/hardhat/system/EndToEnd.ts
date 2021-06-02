/**
 * End-to-end system test running on hardhat. Assumes hardhat is running in node mode, that the deploy
 * has already been done, and that contract json file has been feed into stdin.
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
  SuicidalMockContract,
  SuicidalMockInstance,
  WFlrContract,
  WFlrInstance} from "../../../typechain-truffle";

import { Contracts } from "../../../scripts/Contracts";
import { PriceInfo } from '../../utils/PriceInfo';
import { moveFromCurrentToNextEpochStart, moveToFinalizeStart, moveToRevealStart} from "../../utils/FTSO-test-utils"
import { moveToRewardFinalizeStart } from "../../utils/RewardManagerTestUtils";
import { submitPriceHash } from '../../utils/test-helpers';
const { expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;
const BN = web3.utils.toBN;
var randomNumber = require("random-number-csprng");
const calcGasCost = require('../../utils/eth').calcGasCost; 

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

      await ftso.submitPriceHash(hash!, {from: by});

      const priceInfo = new PriceInfo(epochId, preparedPrice, random);
      priceInfo.moveToNextStatus();
      return priceInfo;
  }
};

async function revealPrice(ftso: FtsoInstance, priceInfo: PriceInfo, by: string): Promise<void> {  
  if (priceInfo?.isSubmitted()) {
    console.log(`Revealing price by ${by} for epoch ${priceInfo.epochId}`);

    priceInfo.moveToNextStatus();

    await ftso.revealPrice(priceInfo.epochId, priceInfo.priceSubmitted, priceInfo.random, { from: by });
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
  let WFlr: WFlrContract;
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
  let SuicidalMock: SuicidalMockContract;
  let suicidalMock: SuicidalMockInstance;

  before(async() => {
    // Get contract addresses of deployed contracts
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);

    // Wire up needed contracts
    FlareKeeper = artifacts.require("FlareKeeper");
    flareKeeper = await FlareKeeper.at(contracts.getContractAddress(Contracts.FLARE_KEEPER));
    RewardManager = artifacts.require("FtsoRewardManager");
    rewardManager = await RewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    FtsoManager = artifacts.require("FtsoManager");
    ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    WFlr = artifacts.require("WFlr");
    wFLR = await WFlr.at(contracts.getContractAddress(Contracts.WFLR));
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

    // Set up the suicidal mock contract so we can conjure FLR into the keeper by self-destruction
    SuicidalMock = artifacts.require("SuicidalMock");
    suicidalMock = await SuicidalMock.new(flareKeeper.address);
  });

  it("Should delegate, price submit, reveal, earn, and claim ftso rewards", async() => {
    // Assemble
    // Define delegators
    let d1 = accounts[1];
    // Define price providers
    let p1 = accounts[2];
    let p2 = accounts[3];
    let p3 = accounts[4];

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

    // Prime the keeper to establish vote power block.
    await flareKeeper.trigger();    

    // A minting request should be pending...
    const mintingRequestWei = await flareKeeper.totalMintingRequestedWei();
    if (mintingRequestWei.gt(BN(0))) {
      // It is, so let's pretend to be the validator and self-destruct what was asked for into the keeper.
      // Give suicidal some FLR
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: mintingRequestWei});
      await suicidalMock.die();
    } else {
      assert(false, "No minting request made. Claiming is not going to work too well...");
    }

    // Set up a fresh price epoch
    await moveFromCurrentToNextEpochStart(firstPriceEpochStartTs.toNumber(), priceEpochDurationSec.toNumber(), 1);
    await flareKeeper.trigger();

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

    // Time travel to reveal period
    await moveToRevealStart(firstPriceEpochStartTs.toNumber(), priceEpochDurationSec.toNumber(), parseInt(p1FlrPrice!.epochId));

    console.log(firstPriceEpochStartTs.toNumber(), priceEpochDurationSec.toNumber(), parseInt(p1FlrPrice!.epochId))
    // await flareKeeper.trigger();  // do not trigger this here

    // Reveal prices
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

    // Time travel to price epoch finalization -> using ~3.2M gas
    await moveToFinalizeStart(
      firstPriceEpochStartTs.toNumber(), 
      priceEpochDurationSec.toNumber(), 
      revealEpochDurationSec.toNumber(), 
      parseInt(p1FlrPrice!.epochId));
    await flareKeeper.trigger({ gas: 10000000 });

    // There should be a balance to claim within reward manager at this point
    assert(BN(await web3.eth.getBalance(rewardManager.address)) > BN(0), "No reward manager balance. Did you forget to mint some?");

    // Time travel to reward epoch finalization
    await moveToRewardFinalizeStart(
      rewardEpochsStartTs.toNumber(), 
      rewardEpochDurationSec.toNumber(), 
      0);
    // Pump the keeper; rewards should now be claimable
    await flareKeeper.trigger();

    // Get the opening balances
    const p1OpeningBalance = BN(await web3.eth.getBalance(p1));
    const p2OpeningBalance = BN(await web3.eth.getBalance(p2));
    const p3OpeningBalance = BN(await web3.eth.getBalance(p3));
    const d1OpeningBalance = BN(await web3.eth.getBalance(d1));
    
    // Act
    // Claim rewards
    const rewardEpochId = (await ftsoManager.getCurrentRewardEpoch()).sub(BN(1));
    const rewardEpochs = [];
    rewardEpochs[0] = rewardEpochId;
    console.log(`Claiming rewards for reward epoch ${rewardEpochId}`);
    let gasCost = BN(0);
    try {
      const tx = await rewardManager.claimReward(p1, rewardEpochs, { from: p1 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p1", e);
    }
    try {
      const tx = await rewardManager.claimReward(p2, rewardEpochs, { from: p2 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p2", e);
    }
    try {
      const tx = await rewardManager.claimReward(p3, rewardEpochs, { from: p3 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p3", e);
    }
    try {
      const tx = await rewardManager.claimReward(d1, rewardEpochs, { from: d1 });
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

    // Compute what we should have distributed for one price epoch
    const numberOfSecondsInDay = BN(3600 * 24);
    // Get the daily inflation authorized on ftso reward manager
    const dailyAuthorizedInflation = await rewardManager.dailyAuthorizedInflation();
    // 1 subtracted from period remaining because first price epoch was used to prime
    // vote power block; no prices were voted on.
    const shouldaClaimed = dailyAuthorizedInflation
      .div(
        numberOfSecondsInDay.div(priceEpochDurationSec).sub(BN(1))
      );

    // Account for allocation truncation during distribution calc
      // TODO: This should be fixed with a double declining balance allocation, where ever it is that
      // is causing this rounding problem.
      const differenceBetweenActualAndExpected = shouldaClaimed.sub(computedRewardClaimed);

    // After all that, one little test...
    assert(differenceBetweenActualAndExpected.lt(BN(10)), `should have claimed ${shouldaClaimed} but actually claimed ${computedRewardClaimed}`);
  });
});
