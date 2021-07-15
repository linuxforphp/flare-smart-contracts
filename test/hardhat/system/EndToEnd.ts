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
  PriceSubmitterContract,
  PriceSubmitterInstance,
  SuicidalMockContract,
  SuicidalMockInstance,
  SupplyContract,
  SupplyInstance,
  WFlrContract,
  WFlrInstance,
  FtsoRegistryInstance,
  VoterWhitelisterInstance,
  VoterWhitelisterContract,
} from "../../../typechain-truffle";

import { Contracts } from "../../../deployment/scripts/Contracts";
import { PriceInfo } from '../../utils/PriceInfo';
import { moveFromCurrentToNextEpochStart, moveToFinalizeStart, moveToRevealStart } from "../../utils/FTSO-test-utils"
import { moveToRewardFinalizeStart } from "../../utils/RewardManagerTestUtils";
import { increaseTimeTo, submitPriceHash } from '../../utils/test-helpers';
const { expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
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

async function submitPricePriceSubmitter(ftsos: FtsoInstance[], ftsoIndices: BN[], priceSubmitter: PriceSubmitterInstance, prices: number[], by: string): Promise<PriceInfo[] | undefined> {
  if (!ftsos || !prices || ftsos.length != prices.length) throw Error("Lists of ftsos and prices illegal or do not match")
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

  console.log(`Submitting prices ${preparedPrices} by ${by} for epoch ${epochId}`);
  // await priceSubmitter.submitPriceHash(hash!, {from: by});
  await priceSubmitter.submitPriceHashes(ftsoIndices, hashes, { from: by })
  for (let i = 0; i < ftsos.length; i++) {
    const priceInfo = new PriceInfo(epochId, preparedPrices[i], randoms[i]);
    priceInfo.moveToNextStatus();
    priceInfos.push(priceInfo);
  }
  return priceInfos
};

async function revealPricePriceSubmitter(ftsos: FtsoInstance[], ftsoIndices: BN[], priceSubmitter: PriceSubmitterInstance, priceInfos: PriceInfo[], by: string): Promise<void> {
  if (!ftsos || !priceInfos || ftsos.length == 0 || ftsos.length != priceInfos.length) throw Error("Lists of ftsos and priceInfos illegal or they do not match")
  let epochId = priceInfos[0].epochId;

  if (priceInfos.some(priceInfo => !priceInfo.isSubmitted())) throw Error("Some price infos not submitted");
  priceInfos.forEach(priceInfo => {
    priceInfo.moveToNextStatus();
  })

  console.log(`Revealing price by ${by} for epoch ${epochId}`);

  let tx = await priceSubmitter.revealPrices(
    epochId,
    ftsoIndices,
    priceInfos.map(priceInfo => priceInfo.priceSubmitted),
    priceInfos.map(priceInfo => priceInfo.random),
    { from: by }
  )
  expectEvent(tx, "PricesRevealed", { success: priceInfos.map(x => true) });
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
  let FtsoRewardManager: FtsoRewardManagerContract;
  let ftsoRewardManager: FtsoRewardManagerInstance;
  let FtsoManager: FtsoManagerContract;
  let ftsoManager: FtsoManagerInstance;
  let PriceSubmitter: PriceSubmitterContract;
  let priceSubmiter: PriceSubmitterInstance;
  let WFlr: WFlrContract;
  let wFLR: WFlrInstance;
  let Supply: SupplyContract;
  let supply: SupplyInstance;
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
  let registry: FtsoRegistryInstance;
  let VoterWhitelister: VoterWhitelisterContract;
  let voterWhitelister: VoterWhitelisterInstance;

  before(async () => {
    // Get contract addresses of deployed contracts
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);

    // Wire up needed contracts
    FlareKeeper = artifacts.require("FlareKeeper");
    flareKeeper = await FlareKeeper.at(contracts.getContractAddress(Contracts.FLARE_KEEPER));
    FtsoRewardManager = artifacts.require("FtsoRewardManager");
    ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    FtsoManager = artifacts.require("FtsoManager");
    ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    PriceSubmitter = artifacts.require("PriceSubmitter");
    priceSubmiter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    VoterWhitelister = artifacts.require("VoterWhitelister");
    voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    
    WFlr = artifacts.require("WFlr");
    wFLR = await WFlr.at(contracts.getContractAddress(Contracts.WFLR));
    Supply = artifacts.require("Supply");
    supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
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

    const FtsoRegistry = artifacts.require("FtsoRegistry");
    registry = await FtsoRegistry.at(await ftsoManager.ftsoRegistry());

  });

  it("Should delegate, price submit, reveal, earn, and claim ftso rewards", async () => {
    // Assemble
    // Define delegators
    let d1 = accounts[1];
    // Define price providers
    let p1 = accounts[2];
    let p2 = accounts[3];
    let p3 = accounts[4];

    // Mint some WFLR for each delegator and price provider
    const someFLR = web3.utils.toWei(BN(3000000000));
    await wFLR.deposit({ from: d1, value: someFLR });
    await wFLR.deposit({ from: p1, value: someFLR });
    await wFLR.deposit({ from: p2, value: someFLR });
    await wFLR.deposit({ from: p3, value: someFLR });

    // Delegator delegates vote power
    await wFLR.delegate(p1, 2500, { from: d1 });
    await wFLR.delegate(p2, 5000, { from: d1 });
    await wFLR.delegate(p3, 2500, { from: d1 });

    // Prime the keeper to establish vote power block.
    await flareKeeper.trigger();

    // Supply contract - inflatable balance should be updated
    const initialGenesisAmountWei = await supply.initialGenesisAmountWei();
    const inflatableBalanceWei = await supply.getInflatableBalance();
    assert(inflatableBalanceWei.gt(initialGenesisAmountWei), "Authorized inflation not distributed...");

    // A minting request should be pending...
    const mintingRequestWei = await flareKeeper.totalMintingRequestedWei();
    if (mintingRequestWei.gt(BN(0))) {
      // It is, so let's pretend to be the validator and self-destruct what was asked for into the keeper.
      // Give suicidal some FLR
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: mintingRequestWei });
      await suicidalMock.die();
    } else {
      assert(false, "No minting request made. Claiming is not going to work too well...");
    }

    // Verify that rewards epoch did not start yet
    expectRevert.unspecified(ftsoManager.rewardEpochs(0))

    // Jump to reward epoch start
    await time.increaseTo(rewardEpochsStartTs.sub(BN(1)));
    await time.advanceBlock();
    await time.increaseTo(rewardEpochsStartTs.add(BN(1))); // sometimes we get a glitch

    await flareKeeper.trigger();
    let firstRewardEpoch = await ftsoManager.rewardEpochs(0);
    let votePowerBlock = firstRewardEpoch[0];

    assert((await wFLR.votePowerOfAt(p1, votePowerBlock)).gt(BN(0)), "Vote power of p1 must be > 0")
    assert((await wFLR.votePowerOfAt(p2, votePowerBlock)).gt(BN(0)), "Vote power of p2 must be > 0")
    assert((await wFLR.votePowerOfAt(p3, votePowerBlock)).gt(BN(0)), "Vote power of p3 must be > 0")


    // Set up a fresh price epoch
    await moveFromCurrentToNextEpochStart(firstPriceEpochStartTs.toNumber(), priceEpochDurationSec.toNumber(), 1);
    await flareKeeper.trigger();

    let flrPrices = [0.35, 0.40, 0.50];
    let xrpPrices = [1.40, 1.50, 1.35];
    let ltcPrices = [320, 340, 350];
    let xdgPrices = [0.37, 0.45, 0.48];
    let dgbPrices = [0.08, 0.11, 0.13];
    let adaPrices = [1.84, 1.90, 1.91];
    let algoPrices = [1.00, 1.33, 1.35];
    let bchPrices = [1100, 1203, 1210];
    let ftsos = [ftsoWflr, ftsoFxrp, ftsoFltc, ftsoFxdg, ftsoFdgb, ftsoFada, ftsoFalgo, ftsoFbch];
    let ftsoIndices = [];


    for(let ftso of ftsos){
      ftsoIndices.push(await registry.getFtsoIndex( await ftso.symbol()));
    }

    let pricesMatrix = [flrPrices, xrpPrices, ltcPrices, xdgPrices, dgbPrices, adaPrices, algoPrices, bchPrices];
    // transpose
    let priceSeries = pricesMatrix[0].map((_, colIndex) => pricesMatrix.map(row => row[colIndex]));

    let submitterPrices: PriceInfo[][] = [];
    let submitters = [p1, p2, p3];

    for (let i = 0; i < submitters.length; i++) {
      voterWhitelister.requestFullVoterWhitelisting(submitters[i]);
      let priceInfo = await submitPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, priceSeries[i], submitters[i]);
      submitterPrices.push(priceInfo!);
    }

    let testPriceEpoch = parseInt(submitterPrices[0][0]!.epochId!);

    // Time travel to reveal period
    await moveToRevealStart(firstPriceEpochStartTs.toNumber(), priceEpochDurationSec.toNumber(), testPriceEpoch);

    // Reveal prices
    for (let i = 0; i < submitters.length; i++) {
      await revealPricePriceSubmitter(ftsos, ftsoIndices, priceSubmiter, submitterPrices[i]!, submitters[i]);
    }

    // Time travel to price epoch finalization -> using ~3.2M gas
    await moveToFinalizeStart(
      firstPriceEpochStartTs.toNumber(),
      priceEpochDurationSec.toNumber(),
      revealEpochDurationSec.toNumber(),
      testPriceEpoch);

    await flareKeeper.trigger({ gas: 10000000 });

    // There should be a balance to claim within reward manager at this point
    assert(BN(await web3.eth.getBalance(ftsoRewardManager.address)) > BN(0), "No reward manager balance. Did you forget to mint some?");

    // Finalize all possible past price epochs including the last one we are testing 
    // Rewards should now be claimable 
    let { 0: currentPriceEpochTmp } = await ftsoManager.getCurrentPriceEpochData();
    // let currentPriceEpoch = currentPriceEpochTmp.toNumber();
    let lastUnprocessed = (await ftsoManager.lastUnprocessedPriceEpoch()).toNumber()
    while (lastUnprocessed <= testPriceEpoch) {
      await flareKeeper.trigger({ gas: 10000000 });
      lastUnprocessed = (await ftsoManager.lastUnprocessedPriceEpoch()).toNumber()
    }

    assert(lastUnprocessed > testPriceEpoch, "Tested price epoch not yet finalized")

    // Time travel to reward epoch finalization
    await moveToRewardFinalizeStart(
      rewardEpochsStartTs.toNumber(),
      rewardEpochDurationSec.toNumber(),
      0);

    await flareKeeper.trigger();

    // TODO: Check ftso prices if they are correct

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
      const tx = await ftsoRewardManager.claimReward(p1, rewardEpochs, { from: p1 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p1", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(p2, rewardEpochs, { from: p2 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p2", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(p3, rewardEpochs, { from: p3 });
      gasCost = gasCost.add(await calcGasCost(tx));
    } catch (e: unknown) {
      spewClaimError("p3", e);
    }
    try {
      const tx = await ftsoRewardManager.claimReward(d1, rewardEpochs, { from: d1 });
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
    const almostFullDaySec = BN(3600 * 24 - 1);
    // Get the daily inflation authorized on ftso reward manager
    const dailyAuthorizedInflation = await ftsoRewardManager.dailyAuthorizedInflation();
    const authorizedInflationTimestamp = await ftsoRewardManager.lastInflationAuthorizationReceivedTs();

    // use the same formula as in ftso reward manager to calculate claimable value
    const dailyPeriodEndTs = authorizedInflationTimestamp.add(almostFullDaySec);
    const priceEpochEndTime = BN(firstPriceEpochStartTs.toNumber() + (testPriceEpoch + 1) * priceEpochDurationSec.toNumber() - 1);
    const shouldaClaimed = dailyAuthorizedInflation.div( 
        (dailyPeriodEndTs.sub(priceEpochEndTime)).div(priceEpochDurationSec).add(BN(1))
    );

    // After all that, one little test...
    assert(shouldaClaimed.eq(computedRewardClaimed), `should have claimed ${ shouldaClaimed } but actually claimed ${ computedRewardClaimed }`);
  });
});
