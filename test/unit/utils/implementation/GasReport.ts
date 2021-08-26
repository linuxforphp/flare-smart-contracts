import { constants, time } from "@openzeppelin/test-helpers";
import fs from "fs";
import { FAssetTokenContract, FAssetTokenInstance, FtsoInstance, FtsoRegistryInstance, FtsoRewardManagerContract, FtsoRewardManagerInstance, PriceSubmitterInstance, SupplyInstance, VoterWhitelisterInstance, WFlrInstance } from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize, getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { increaseTimeTo, submitPriceHash, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const VoterWhitelister = artifacts.require("VoterWhitelister");
const WFlr = artifacts.require("WFlr");
const Ftso = artifacts.require("Ftso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const Supply = artifacts.require("Supply");
const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const FAssetToken = artifacts.require("FAssetToken") as FAssetTokenContract;

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

contract(`a few contracts; ${getTestFile(__filename)}; FTSO gas consumption tests`, async accounts => {
  const governance = GOVERNANCE_GENESIS_ADDRESS;
  const ftsoManager = accounts[33];
  const inflation = accounts[34];

  const epochDurationSec = 1000;
  const revealDurationSec = 500;

  let whitelist: VoterWhitelisterInstance;
  let priceSubmitter: PriceSubmitterInstance;
  let startTs: BN;

  let wflr: WFlrInstance;
  let flrFtso: FtsoInstance;

  let ftsoRegistry: FtsoRegistryInstance;

  let supplyInterface: SupplyInstance;

  let vpBlockNumber: number;
  let epochId: number;
  let ftsoRewardManager: FtsoRewardManagerInstance;

  async function createFtso(symbol: string, initialPrice: BN) {
    const ftso = await Ftso.new(symbol, wflr.address, ftsoManager, supplyInterface.address, initialPrice, 1e10, defaultPriceEpochCyclicBufferSize);
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

  async function initializeRewardEpoch(vpBlock?: number, flrSupply: BN | number = eth(1000)) {
    // set votepower block
    vpBlockNumber = vpBlock ?? await web3.eth.getBlockNumber();
    await time.advanceBlock();
    const ftsoAddrList = await ftsoRegistry.getAllFtsos();
    const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
    for (const ftso of ftsoList) {
      await ftso.setVotePowerBlock(vpBlockNumber, { from: ftsoManager });
    }
    // await setFlrSupply(flrSupply, vpBlockNumber);
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

  describe('Wflr transfer', function () {

    beforeEach(async () => {
      wflr = await WFlr.new(governance);
      await setDefaultVPContract(wflr, governance);
    });

    it("Should test gas for wflr transfer when sender and receiver have 2 delegates", async () => {
      await wflr.deposit({ from: accounts[1], value: "100" });
      await wflr.deposit({ from: accounts[2], value: "100" });

      await wflr.delegate(accounts[2], 50, { from: accounts[1] });
      await wflr.delegate(accounts[3], 50, { from: accounts[1] });

      await wflr.delegate(accounts[1], 50, { from: accounts[2] });
      await wflr.delegate(accounts[3], 50, { from: accounts[2] });

      let transferTx = await wflr.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`transfer wflr from sender and receiver with 2 delegates each(by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wflr from sender and receiver with 2 delegates each(by percentage)", "gasUsed": transferTx.receipt.gasUsed });
    });

    it("Should test gas for wflr transfer where both sender and receiver have 3 delegates", async () => {
      await wflr.deposit({ from: accounts[1], value: "100" });
      await wflr.deposit({ from: accounts[2], value: "100" });

      await wflr.delegate(accounts[2], 50, { from: accounts[1] });
      await wflr.delegate(accounts[3], 50, { from: accounts[1] });
      await wflr.delegate(accounts[4], 50, { from: accounts[1] });

      await wflr.delegate(accounts[1], 50, { from: accounts[2] });
      await wflr.delegate(accounts[3], 50, { from: accounts[2] });
      await wflr.delegate(accounts[4], 50, { from: accounts[2] });

      let transferTx = await wflr.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`wflr transfer from sender and receiver with 3 delegates each(by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "transfer wflr from sender and receiver with 3 delegates each(by percentage)", "gasUsed": transferTx.receipt.gasUsed })
    });

    it("Should test gas for wflr transfer where both sender and receiver with 0 delegates", async () => {
      await wflr.deposit({ from: accounts[1], value: "100" });
      await wflr.deposit({ from: accounts[2], value: "100" });

      await wflr.delegate(accounts[2], 50, { from: accounts[1] });
      await wflr.delegate(accounts[3], 50, { from: accounts[1] });
      await wflr.delegate(accounts[4], 50, { from: accounts[1] });

      let transferTx = await wflr.transfer(accounts[2], 10, { from: accounts[1] });
      console.log(`wflr transfer where both sender and receiver have 3 delegates (by percentage): ${transferTx.receipt.gasUsed}`);
      gasReport.push({ "function": "wflr transfer where both sender and receiver have 3 delegates (by percentage)", "gasUsed": transferTx.receipt.gasUsed })
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

    let assets: FAssetTokenInstance[];
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
      wflr = await WFlr.new(governance);
      await setDefaultVPContract(wflr, governance);
      assets = [];
      for (const [name, symbol, _] of assetData) {
        const asset = await FAssetToken.new(governance, name, symbol, 6);
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
        await wflr.deposit({ from: voter, value: vp });
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wflr.votePowerOfAtCached(voter, vpBlockNumber);
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
        await wflr.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wflr.votePowerOfAtCached(voter, vpBlockNumber);
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
        await wflr.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wflr.votePowerOfAtCached(voter, vpBlockNumber);
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
        await wflr.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wflr.votePowerOfAtCached(voter, vpBlockNumber);
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
        await wflr.deposit({ from: voter, value: vp });
        for (const asset of assets) {
          await asset.mint(voter, vp, { from: governance });
        }
      }
      await initializeRewardEpoch();
      // warm cache
      for (const voter of voters) {
        await wflr.votePowerOfAtCached(voter, vpBlockNumber);
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
