import { constants, time } from "@openzeppelin/test-helpers";
import fs from "fs";
import { AssetTokenContract, AssetTokenInstance, FtsoInstance, FtsoRegistryInstance, FtsoRewardManagerContract, FtsoRewardManagerInstance, PriceSubmitterInstance, SupplyInstance, VoterWhitelisterInstance, WNatInstance } from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize, getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { increaseTimeTo, submitPriceHash, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const VoterWhitelister = artifacts.require("VoterWhitelister");
const WNat = artifacts.require("WNat");
const Ftso = artifacts.require("Ftso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const Supply = artifacts.require("Supply");
const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const AssetToken = artifacts.require("AssetToken") as AssetTokenContract;

function toBNFixed(x: number, decimals: number) {
  const prec = Math.min(decimals, 6);
  const s = x.toFixed(prec);
  const dot = s.indexOf('.');
  const bn = toBN(s.slice(0, dot) + s.slice(dot + 1));
  return prec === decimals ? bn : bn.mul(toBN(10).pow(toBN(decimals - prec)));
}

function eth(x: number) {
  return toBNFixed(x, 18);
}

function usd(x: number) {
  return toBNFixed(x, 5);     // asset prices are multiplied by 10**5 (see Ftso.sol)
}

function fmtNum(x: BN) {
  const xn = Number(x.toString());
  return xn < 1e4 ? xn.toString() : xn.toExponential(3);
}
const gasReport: object[] = [];

contract(`a few contracts; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const governance = GOVERNANCE_GENESIS_ADDRESS;
  const ftsoManager = accounts[33];
  const inflation = accounts[34];

  const epochDurationSec = 1000;
  const revealDurationSec = 500;

  let whitelist: VoterWhitelisterInstance;
  let priceSubmitter: PriceSubmitterInstance;
  let startTs: BN;

  let wNat: WNatInstance;
  let natFtso: FtsoInstance;

  let ftsoRegistry: FtsoRegistryInstance;

  let supplyInterface: SupplyInstance;

  let vpBlockNumber: number;
  let epochId: number;
  let ftsoRewardManager: FtsoRewardManagerInstance;

  async function createFtso(symbol: string, initialPrice: BN) {
    const ftso = await Ftso.new(symbol, wNat.address, ftsoManager, supplyInterface.address, initialPrice, 1e10, defaultPriceEpochCyclicBufferSize);
    await ftsoRegistry.addFtso(ftso.address, { from: ftsoManager });
    // add ftso to price submitter and whitelist
    const ftsoIndex = await ftsoRegistry.getFtsoIndex(symbol);
    await whitelist.addFtso(ftsoIndex, { from: ftsoManager });
    // both turnout thresholds are set to 0 to match whitelist vp calculation (which doesn't use turnout)
    const trustedVoters = accounts.slice(101, 101 + 10);
    await ftso.configureEpochs(1, 1, 1000, 10000, 0, 0, trustedVoters, { from: ftsoManager });
    await ftso.activateFtso(priceSubmitter.address, 0, epochDurationSec, revealDurationSec, { from: ftsoManager });
    return ftso;
  }

  async function initializeRewardEpoch(vpBlock?: number, natSupply: BN | number = eth(1000)) {
    // set votepower block
    vpBlockNumber = vpBlock ?? await web3.eth.getBlockNumber();
    await time.advanceBlock();
    const ftsoAddrList = await ftsoRegistry.getAllFtsos();
    const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
    for (const ftso of ftsoList) {
      await ftso.setVotePowerBlock(vpBlockNumber, { from: ftsoManager });
    }
    // await setNatSupply(natSupply, vpBlockNumber);
    await startNewPriceEpoch();
  }

  async function advanceTimeTo(target: number) {
    await time.advanceBlock();
    let timestamp = await time.latest();
    if (timestamp.toNumber() >= target) return;
    await increaseTimeTo(target, 'web3');
  }

  async function startNewPriceEpoch() {
    await time.advanceBlock();
    let timestamp = await time.latest();
    epochId = Math.floor(timestamp.toNumber() / epochDurationSec) + 1;
    await increaseTimeTo(epochId * epochDurationSec, 'web3');
  }

  async function initializeForReveal() {
    const ftsoAddrList = await ftsoRegistry.getAllFtsos();
    const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
    for (const ftso of ftsoList) {
      await ftso.initializeCurrentEpochStateForReveal(false, { from: ftsoManager });
    }
    await advanceTimeTo((epochId + 1) * epochDurationSec); // reveal period start
  }

  describe('Wnat transfer', function () {

    beforeEach(async () => {
      wNat = await WNat.new(governance);
      await setDefaultVPContract(wNat, governance);
    });
    
    it("Should test gas for wNat transfer where both sender and receiver have 0 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where both sender and receiver have 0 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where both sender and receiver have 0 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where sender has 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 1 delegate and receiver has 0 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 1 delegate and receiver has 0 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed });
    });

    it("Should test gas for wNat transfer where receiver has 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 0 delegates and receiver has 1 delegate (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 0 delegates and receiver has 1 delegate (by percentage)", "gasUsed": transferTx.receipt.gasUsed });
    });

    it("Should test gas for wNat transfer where both sender and receiver have 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[3], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where both sender and receiver have 1 delegate (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where both sender and receiver have 1 delegate (by percentage)", "gasUsed": transferTx.receipt.gasUsed });
    });

    it("Should test gas for wNat transfer where sender has 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[4], 50, { from: accounts[1] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 2 delegates and receiver has 0 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 2 delegates and receiver has 0 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where receiver has 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });
      await wNat.delegate(accounts[4], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 0 delegates and receiver has 2 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 0 delegates and receiver has 2 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where sender has 2 delegates and reveiver has 1 delegate", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[4], 50, { from: accounts[1] });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 2 delegates and receiver has 1 delegate (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 2 delegates and receiver has 1 delegate (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where sender has 1 delegate and receiver has 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });
      await wNat.delegate(accounts[4], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where sender has 1 delegate and receiver has 2 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where sender has 1 delegate and receiver has 2 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wNat transfer where both sender and receiver have 2 delegates", async () => {
      await wNat.deposit({ from: accounts[1], value: "100" });
      await wNat.deposit({ from: accounts[2], value: "100" });

      await wNat.delegate(accounts[3], 50, { from: accounts[1] });
      await wNat.delegate(accounts[4], 50, { from: accounts[1] });

      await wNat.delegate(accounts[3], 50, { from: accounts[2] });
      await wNat.delegate(accounts[4], 50, { from: accounts[2] });

      let transferTx = await wNat.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wNat where both sender and receiver have 2 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wNat where both sender and receiver have 2 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });
  })

  describe("FTSO gas benchmarking", async () => {
    let assetData: Array<[name: string, symbol: string, price: BN]> = [
      ["Ripple", "XRP", usd(0.5)],
      ["Bitcoin", "BTC", usd(5)],
      ["Ethereum", "ETH", usd(2)],
      ["Dodge", "DOGE", usd(0.2)],
      ["Polkadot", "DOT", usd(1.5)],
      ['Chiliz ', "CHZ", usd(0.6)],
      ['Algorand', 'ALGO', usd(1.1)],
      ['Chainlink', 'LINK', usd(20)]
    ]

    let assets: AssetTokenInstance[];
    let ftsos: FtsoInstance[];

    beforeEach(async () => {
      // create price submitter
      priceSubmitter = await PriceSubmitter.new();
      await priceSubmitter.initialiseFixedAddress();

      startTs = await time.latest();

      ftsoRewardManager = await FtsoRewardManager.new(
        accounts[0],
        3,
        0,
        inflation
      );

      // set the daily authorized inflation...this proxies call to ftso reward manager
      await ftsoRewardManager.setDailyAuthorizedInflation(1000000, { from: inflation });

      // create registry
      ftsoRegistry = await FtsoRegistry.new(governance);
      await ftsoRegistry.setFtsoManagerAddress(ftsoManager, { from: governance });
      // create whitelister
      whitelist = await VoterWhitelister.new(governance, priceSubmitter.address, 500);
      await whitelist.setContractAddresses(ftsoRegistry.address, ftsoManager, { from: governance });
      await priceSubmitter.setContractAddresses(ftsoRegistry.address, whitelist.address, ftsoManager, { from: governance });
      // create assets
      wNat = await WNat.new(governance);
      await setDefaultVPContract(wNat, governance);
      assets = [];
      for (const [name, symbol, _] of assetData) {
        const asset = await AssetToken.new(governance, name, symbol, 6);
        await setDefaultVPContract(asset, governance);
        assets.push(asset);
      }
      // create supply
      supplyInterface = await Supply.new(governance, constants.ZERO_ADDRESS, governance, 10_000, 0, []);
      // create ftsos
      ftsos = [];
      for (let i = 0; i < assets.length; i++) {
        const [_, symbol, price] = assetData[i];
        const ftso = await createFtso(symbol, price);
        ftsos.push(ftso);
      }
    });

    it("Should test gas to submit and reveal price for one ftso", async () => {
      const voters = accounts.slice(101, 102);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const randoms = prices.map(_ => toBN(Math.round(Math.random() * 1e9)));
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await ftsoRegistry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hashes = allFtsos.map((ftso, i) => submitPriceHash(prices[i], randoms[i], voter));
        let submitTx = await priceSubmitter.submitPriceHashes(epochId, indices, hashes, { from: voter });
        console.log(`submit price for single ftso: ${submitTx.receipt.gasUsed}`);
        gasReport.push({ "function": "submit price for single ftso", "gasUsed": submitTx.receipt.gasUsed });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        let revealTx = await priceSubmitter.revealPrices(epochId, indices, prices, randoms, { from: voter });
        console.log(`reveal price for single ftso: ${revealTx.receipt.gasUsed}`);
        gasReport.push({ "function": "reveal price for single ftso", "gasUsed": revealTx.receipt.gasUsed });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
    });

    it("Should test gas to submit and reveal prices for 8 ftsos", async () => {
      const voters = accounts.slice(101, 102);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [...ftsos];
      const prices = [usd(0.6), usd(5.5), usd(1.9), usd(0.23), usd(1.4), usd(0.5), usd(1.2), usd(19.7)];
      const randoms = prices.map(_ => toBN(Math.round(Math.random() * 1e9)));
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await ftsoRegistry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hashes = allFtsos.map((ftso, i) => submitPriceHash(prices[i], randoms[i], voter));
        let submitTx = await priceSubmitter.submitPriceHashes(epochId, indices, hashes, { from: voter });
        console.log(`submit price 8 ftso: ${submitTx.receipt.gasUsed}`);
        gasReport.push({ "function": "submit prices for 8 ftso", "gasUsed": submitTx.receipt.gasUsed });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        let revealTx = await priceSubmitter.revealPrices(epochId, indices, prices, randoms, { from: voter });
        gasReport.push({ "function": "reveal prices for 8 ftso", "gasUsed": revealTx.receipt.gasUsed });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
    });

    it("Should test gas for finalizing price epoch for 50 submissions", async () => {
      const voters = accounts.slice(101, 101 + 50);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const randoms = prices.map(_ => toBN(Math.round(Math.random() * 1e9)));
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await ftsoRegistry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hashes = allFtsos.map((ftso, i) => submitPriceHash(prices[i], randoms[i], voter));
        await priceSubmitter.submitPriceHashes(epochId, indices, hashes, { from: voter });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        await priceSubmitter.revealPrices(epochId, indices, prices, randoms, { from: voter });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
      for (const ftso of allFtsos) {
        let finalizeTx = await ftso.finalizePriceEpoch(epochId, false, { from: ftsoManager });
        console.log(`finalize price epoch for 50 submissions: ${finalizeTx.receipt.gasUsed}`);
        gasReport.push({ "function": "finalize price epoch for 50 submissions", "gasUsed": finalizeTx.receipt.gasUsed });
      }
    });

    it("Should test gas for finalizing price epoch for 100 submissions", async () => {
      const voters = accounts.slice(101, 101 + 100);
      const vp = eth(1.5);
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const randoms = prices.map(_ => toBN(Math.round(Math.random() * 1e9)));
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await ftsoRegistry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hashes = allFtsos.map((ftso, i) => submitPriceHash(prices[i], randoms[i], voter));
        await priceSubmitter.submitPriceHashes(epochId, indices, hashes, { from: voter });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        await priceSubmitter.revealPrices(epochId, indices, prices, randoms, { from: voter });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
      for (const ftso of allFtsos) {
        let finalizeTx = await ftso.finalizePriceEpoch(epochId, false, { from: ftsoManager });
        console.log(`finalize price epoch for 100 submissions: ${finalizeTx.receipt.gasUsed}`);
        gasReport.push({ "function": "finalize price epoch for 100 submissions", "gasUsed": finalizeTx.receipt.gasUsed });
      }
      fs.unlinkSync('gas-report.json');
      fs.writeFile('gas-report.json', JSON.stringify(gasReport, null, 2) + '\n', { flag: 'a+' }, err => { return err })
    });

    it.skip("Should test gas for finalizing price epoch for 300 submissions", async () => {
      const voters = accounts.slice(101, 101 + 300);
      const vp = eth(1.5);
      let finalizeTxt = 0;
      // Assemble
      for (const voter of voters) {
        await wNat.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wNat.votePowerOfAtCached(voter, vpBlockNumber);
        for (const asset of assets) {
          await asset.votePowerOfAtCached(voter, vpBlockNumber);
        }
      }
      // Act
      const allFtsos = [ftsos[0]];
      const prices = [usd(2.1)];
      const randoms = prices.map(_ => toBN(Math.round(Math.random() * 1e9)));
      const indices: BN[] = [];
      for (const ftso of allFtsos) {
        const symbol = await ftso.symbol();
        indices.push(await ftsoRegistry.getFtsoIndex(symbol));
      }
      // whitelist
      await initializeForReveal();
      for (const voter of voters) {
        await whitelist.requestFullVoterWhitelisting(voter);
      }
      // submit hashes
      await startNewPriceEpoch();
      for (const voter of voters) {
        const hashes = allFtsos.map((ftso, i) => submitPriceHash(prices[i], randoms[i], voter));
        await priceSubmitter.submitPriceHashes(epochId, indices, hashes, { from: voter });
      }
      // reveal prices
      await initializeForReveal();
      for (const voter of voters) {
        await priceSubmitter.revealPrices(epochId, indices, prices, randoms, { from: voter });
      }
      // finalize
      await advanceTimeTo((epochId + 1) * epochDurationSec + revealDurationSec); // reveal period end
      for (const ftso of allFtsos) {
        let finalizeTx = await ftso.finalizePriceEpoch(epochId, false, { from: ftsoManager });
        console.log(`finalize price epoch for 300 submissions: ${finalizeTx.receipt.gasUsed}`);
        gasReport.push({ "function": "finalize price epoch for 300 submissions", "gasUsed": finalizeTx.receipt.gasUsed });
      }
    });
  });
});
