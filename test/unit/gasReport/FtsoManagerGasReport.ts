import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetTokenInstance, FtsoInstance, FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerInstance, PriceSubmitterInstance, SupplyInstance, VoterWhitelisterInstance, WNatInstance } from "../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize, getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../utils/constants";
import { increaseTimeTo, submitPriceHash, toBN } from "../../utils/test-helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";

const VoterWhitelister = artifacts.require("VoterWhitelister");
const WNat = artifacts.require("WNat");
const Ftso = artifacts.require("Ftso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const Supply = artifacts.require("Supply");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const AssetToken = artifacts.require("AssetToken");
const FtsoManager = artifacts.require("FtsoManager");

function toBNFixed(x: number, decimals: number) {
  const prec = Math.min(decimals, 6);
  const s = x.toFixed(prec);
  const dot = s.indexOf('.');
  const bn = toBN(s.slice(0, dot) + s.slice(dot + 1));
  return prec === decimals ? bn : bn.mul(toBN(10).pow(toBN(decimals - prec)));
}

function usd(x: number) {
  return toBNFixed(x, 5);     // asset prices are multiplied by 10**5 (see Ftso.sol)
}

contract(`FtsoManager.sol; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const governance = GOVERNANCE_GENESIS_ADDRESS;
  const flareDaemon = accounts[33];
  const inflation = accounts[34];

  const epochDurationSec = 1000;
  const revealDurationSec = 500;
  const rewardDurationSec = 1000000;

  let whitelist: VoterWhitelisterInstance;
  let priceSubmitter: PriceSubmitterInstance;
  let ftsoRegistry: FtsoRegistryInstance;
  let supplyInterface: SupplyInstance;
  let startTs: BN;
  let rewardStartTs: BN;

  let assets: AssetTokenInstance[];
  let ftsos: FtsoInstance[];
  let wNat: WNatInstance;
  let natFtso: FtsoInstance;
  let trustedVoters: string[];

  let vpBlockNumber: number;
  let epochId: number;
  let ftsoRewardManager: FtsoRewardManagerInstance;
  let ftsoManager: FtsoManagerInstance;

  async function createFtso(symbol: string, initialPrice: BN) {
    const ftso = await Ftso.new(symbol, priceSubmitter.address, wNat.address, ftsoManager.address, initialPrice, 10000, defaultPriceEpochCyclicBufferSize);
    await ftsoManager.addFtso(ftso.address, { from: governance });
    return ftso;
  }

  async function createAssetsAndFtsos(noOfSingleAssetFtsos: number, noOfAssetsInMultiFtso: number) {
    let assetData: Array<[name: string, symbol: string, price: BN]> = [
      ["Ripple", "XRP", usd(0.5)],
      ["Litecoin", "LTC", usd(1.1)],
      ["XLM (Lumen)", "XLM", usd(1.6)],
      ["Dogecoin", "DOGE", usd(2.4)],
      ["ADA (Cardano)", "ADA", usd(2.6)],
      ["Algorand", "ALGO", usd(1.1)],
      ["Bitcoin Cash", "BCH", usd(0.7)],
      ["Digibyte", "DGB", usd(2.1)],
      ["Bitcoin", "BTC", usd(5)],
      ["Ethereum", "ETH", usd(2)],
      ["Binance Coin", "BNB", usd(0.2)],
      ["Polkadot", "DOT", usd(1.5)],
      ["Chiliz", "CHZ", usd(0.6)],
      ["Chainlink", "LINK", usd(20)],
      ["Solana", "SOL", usd(0.6)],
      ["Filecoin", "FIL", usd(2)]
    ]

    // create assets
    assets = [];
    for (const [name, symbol, _] of assetData.slice(0, noOfSingleAssetFtsos)) {
      const asset = await AssetToken.new(governance, name, symbol, 18);
      await setDefaultVPContract(asset, governance);
      assets.push(asset);
    }

    // create ftsos
    natFtso = await createFtso("NAT", usd(1));
    ftsos = [];
    for (let i = 0; i < assets.length; i++) {
      const [_, symbol, price] = assetData[i];
      const ftso = await createFtso(symbol, price);
      await ftsoManager.setFtsoAsset(ftso.address, assets[i].address, { from: governance });
      ftsos.push(ftso);
    }
    await ftsoManager.setFtsoAssetFtsos(natFtso.address, ftsos.slice(0, noOfAssetsInMultiFtso).map(f => f.address), { from: governance });
  }

  async function getCurrentEpochId(): Promise<number> {
    await time.advanceBlock();
    let timestamp = await time.latest();
    return Math.floor(timestamp.sub(startTs).toNumber() / epochDurationSec);
  }

  async function ftsoManagerGasBenchmarking(
    noOfVoters: number,
    noOfSingleAssetFtsos: number,
    noOfAssetsInMultiFtso: number,
    noOfPriceEpochs: number,
    randomPrices: boolean,
    updateGovernanceParameters: boolean
  ) {
    const voters = accounts.slice(10, 10 + noOfVoters);

    // Assemble
    await createAssetsAndFtsos(noOfSingleAssetFtsos, noOfAssetsInMultiFtso);
    for (const voter of voters) {
      await wNat.deposit({ from: voter, value: toBN(Math.round(Math.random() * 1e18)) });
      for (const asset of assets) {
        await asset.mint(voter, toBN(Math.round(Math.random() * 1e18)), { from: governance });
      }
    }

    let normalDaemonizeCallTx = await ftsoManager.daemonize({ from: flareDaemon });
    console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);

    const allFtsos = [natFtso, ...ftsos];
    const indices: BN[] = [];
    for (const ftso of allFtsos) {
      const symbol = await ftso.symbol();
      indices.push(await ftsoRegistry.getFtsoIndex(symbol));
    }
    // whitelist
    for (const voter of voters) {
      await whitelist.requestFullVoterWhitelisting(voter);
    }

    normalDaemonizeCallTx = await ftsoManager.daemonize({ from: flareDaemon });
    console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);

    await increaseTimeTo(rewardStartTs, 'web3');

    // initialize first reward epoch
    await expectRevert(ftsoManager.getCurrentRewardEpoch(), "Reward epoch not initialized yet");
    let initializeFirstRewardEpochTx = await ftsoManager.daemonize({ from: flareDaemon });
    vpBlockNumber = (await ftsoManager.getRewardEpochVotePowerBlock(0)).toNumber();
    assert(vpBlockNumber > 0, "first reward epoch not initialized");
    console.log(`initialize first reward epoch: ${initializeFirstRewardEpochTx.receipt.gasUsed}`);

    epochId = await getCurrentEpochId();
    assert(epochId > 0, "epochId == 0");

    for (let i = 0; i < noOfPriceEpochs; i++) {
      await expectRevert(natFtso.getEpochPrice(epochId), "Epoch data not available");

      if (updateGovernanceParameters) {
        if (i % 2 == 0) {
          trustedVoters = accounts.slice(0, 5);
          await ftsoManager.setGovernanceParameters(9, 11, 1, 3000000001, 99, 1, 2, trustedVoters, { from: governance });
        } else {
          trustedVoters = accounts.slice(1, 6);
          await ftsoManager.setGovernanceParameters(10, 10, 0, 3000000000, 100, 0, 1, trustedVoters, { from: governance });
        }
      }
      let initializePriceEpochForRevealTx = await ftsoManager.daemonize({ from: flareDaemon });
      let price = await natFtso.getEpochPrice(epochId); // should not revert
      assert(price.toNumber() == 0, "price != 0");
      console.log(`initialize price epoch for reveal: ${initializePriceEpochForRevealTx.receipt.gasUsed}`);

      normalDaemonizeCallTx = await ftsoManager.daemonize({ from: flareDaemon });
      console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);

      const voterPrices = new Map<string, BN[]>();
      const voterRandoms = new Map<string, BN[]>();

      // submit hashes (worst case - all users submits equal prices)
      const equalPrices = allFtsos.map(_ => toBN(Math.round(Math.random() * 2e5)));
      for (const voter of [...trustedVoters, ...voters]) {
        const randoms = allFtsos.map(_ => toBN(Math.round(Math.random() * 1e9)));
        const prices = randomPrices ? allFtsos.map(_ => toBN(Math.round(Math.random() * 2e5))) : equalPrices;
        voterPrices.set(voter, prices);
        voterRandoms.set(voter, randoms);
        const hashes = allFtsos.map((_, i) => submitPriceHash(prices[i], randoms[i], voter));
        await priceSubmitter.submitPriceHashes(epochId, indices, hashes, { from: voter });
      }

      normalDaemonizeCallTx = await ftsoManager.daemonize({ from: flareDaemon });
      console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);


      // reveal prices
      await increaseTimeTo(startTs.addn((epochId + 1) * epochDurationSec), 'web3'); // reveal period start
      for (const voter of [...trustedVoters, ...voters]) {
        await priceSubmitter.revealPrices(epochId, indices, voterPrices.get(voter)!, voterRandoms.get(voter)!, { from: voter });
      }

      normalDaemonizeCallTx = await ftsoManager.daemonize({ from: flareDaemon });
      console.log(`daemonize call with no work to do: ${normalDaemonizeCallTx.receipt.gasUsed}`);

      // finalize price epoch
      await increaseTimeTo(startTs.addn((epochId + 1) * epochDurationSec + revealDurationSec), 'web3'); // reveal period end
      price = await natFtso.getEpochPrice(epochId); // should not revert
      assert(price.toNumber() == 0, "price != 0");
      let finalizePriceEpochTx = await ftsoManager.daemonize({ from: flareDaemon });
      price = await natFtso.getEpochPrice(epochId); // should not revert
      assert(price.toNumber() > 0, "price == 0");
      console.log(`finalize price epoch: ${finalizePriceEpochTx.receipt.gasUsed}`);

      expectEvent.inTransaction(finalizePriceEpochTx.tx, ftsoRewardManager, "RewardsDistributed", { epochId: toBN(epochId) });

      epochId++;
    }


    // finalize first reward epoch
    await increaseTimeTo(rewardStartTs.addn(rewardDurationSec), 'web3'); // reward epoch end
    let rewardEpoch = await ftsoManager.getCurrentRewardEpoch();
    assert(rewardEpoch.toNumber() == 0, "rewardEpoch != 0");
    let finalizeRewardEpochTx = await ftsoManager.daemonize({ from: flareDaemon });
    rewardEpoch = await ftsoManager.getCurrentRewardEpoch();
    assert(rewardEpoch.toNumber() > 0, "rewardEpoch == 0");
    console.log(`finalize first reward epoch: ${finalizeRewardEpochTx.receipt.gasUsed}`);
  }

  describe("Ftso manager gas benchmarking", async () => {

    beforeEach(async () => {
      // create price submitter
      priceSubmitter = await PriceSubmitter.new();
      await priceSubmitter.initialiseFixedAddress();

      // create ftso reward manager
      ftsoRewardManager = await FtsoRewardManager.new(
        governance,
        3,
        0
      );

      // create supply
      supplyInterface = await Supply.new(governance, constants.ZERO_ADDRESS, inflation, 10_000, 0, []);
      // create registry
      ftsoRegistry = await FtsoRegistry.new(governance);
      // create whitelister
      whitelist = await VoterWhitelister.new(governance, priceSubmitter.address, 100);

      // create ftso manager
      startTs = await time.latest();
      rewardStartTs = startTs.addn(2 * epochDurationSec + revealDurationSec);
      ftsoManager = await FtsoManager.new(
        governance,
        flareDaemon,
        priceSubmitter.address,
        startTs,
        epochDurationSec,
        revealDurationSec,
        rewardStartTs,
        rewardDurationSec,
        7
      );

      await ftsoManager.setContractAddresses(ftsoRewardManager.address, ftsoRegistry.address,
        whitelist.address, supplyInterface.address, constants.ZERO_ADDRESS, { from: governance });

      trustedVoters = accounts.slice(1, 6);
      await ftsoManager.setGovernanceParameters(10, 10, 0, 3000000000, 100, 0, 1, trustedVoters, { from: governance });
      await ftsoManager.activate({ from: governance });

      // create wNat
      wNat = await WNat.new(governance, "Wrapped NAT", "WNAT");
      await setDefaultVPContract(wNat, governance);

      // set contract addresses
      await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address, { from: governance });
      await whitelist.setContractAddresses(ftsoRegistry.address, ftsoManager.address, { from: governance });
      await priceSubmitter.setContractAddresses(ftsoRegistry.address, whitelist.address, ftsoManager.address, { from: governance });
      await ftsoRewardManager.setContractAddresses(inflation, ftsoManager.address, wNat.address, { from: governance });
      await ftsoRewardManager.activate({ from: governance });

      // set the daily authorized inflation...this proxies call to ftso reward manager
      await ftsoRewardManager.setDailyAuthorizedInflation(1000000, { from: inflation });
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 4 ftsos (10 voters + 5 trusted addresses, 4 runs, random prices)", async () => {
      await ftsoManagerGasBenchmarking(100, 4, 4, 4, true, false);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 4 ftsos (100 voters + 5 trusted addresses, 4 runs, equal prices, update governance parameters)", async () => {
      await ftsoManagerGasBenchmarking(100, 4, 4, 4, false, true);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 8 ftsos (100 voters + 5 trusted addresses, 4 runs, random prices)", async () => {
      await ftsoManagerGasBenchmarking(100, 8, 4, 4, true, false);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 8 ftsos (100 voters + 5 trusted addresses, 4 runs, equal prices, update governance parameters)", async () => {
      await ftsoManagerGasBenchmarking(100, 8, 4, 4, false, true);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 12 ftsos (100 voters + 5 trusted addresses, 4 runs, random prices)", async () => {
      await ftsoManagerGasBenchmarking(100, 12, 4, 4, true, false);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 12 ftsos (100 voters + 5 trusted addresses, 4 runs, equal prices, update governance parameters)", async () => {
      await ftsoManagerGasBenchmarking(100, 12, 4, 4, false, true);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 16 ftsos (100 voters + 5 trusted addresses, 4 runs, random prices)", async () => {
      await ftsoManagerGasBenchmarking(100, 16, 4, 4, true, false);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 4 assets + 16 ftsos (100 voters + 5 trusted addresses, 4 runs, equal prices, update governance parameters)", async () => {
      await ftsoManagerGasBenchmarking(100, 16, 4, 4, false, true);
    });

    // real conditions
    it("Ftso manager daemonize calls for wNat ftso with 5 assets + 14 ftsos (100 voters + 5 trusted addresses, 4 runs, random prices)", async () => {
      await ftsoManagerGasBenchmarking(100, 14, 5, 4, true, false);
    });

    it.skip("Ftso manager daemonize calls for wNat ftso with 5 assets + 14 ftsos (100 voters + 5 trusted addresses, 4 runs, equal prices, update governance parameters)", async () => {
      await ftsoManagerGasBenchmarking(100, 14, 5, 4, false, true);
    });

  });
});
