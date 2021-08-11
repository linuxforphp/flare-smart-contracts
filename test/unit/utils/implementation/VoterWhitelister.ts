import { constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { FtsoRegistryInstance, MockContractInstance, MockFtsoInstance, SupplyInstance, VoterWhitelisterMockInstance, VPTokenMockInstance, WFlrInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { assertNumberEqual, compareArrays, compareSets, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const VoterWhitelister = artifacts.require("VoterWhitelisterMock");
const WFlr = artifacts.require("WFlr");
const VPToken = artifacts.require("VPTokenMock");
const Ftso = artifacts.require("MockFtso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const Supply = artifacts.require("Supply");
const MockContract = artifacts.require("MockContract");

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

contract(`VoterWhitelister.sol; ${getTestFile(__filename)}; Voter whitelist unit tests`, async accounts => {
    const governance = accounts[32];
    const ftsoManager = accounts[33];

    let whitelist: VoterWhitelisterMockInstance;
    let priceSubmitter: MockContractInstance;

    let wflr: WFlrInstance;
    let flrFtso: MockFtsoInstance;

    let ftsoRegistry: FtsoRegistryInstance;

    let supplyInterface: SupplyInstance;
    let supplyMock: MockContractInstance;

    let vpBlockNumber: number;

    async function setFlrSupply(amount: number | BN, blockNumber: number) {
        const getCirculatingSupplyAtCached = supplyInterface.contract.methods.getCirculatingSupplyAtCached(blockNumber).encodeABI();
        const getCirculatingSupplyAtCachedReturn = web3.eth.abi.encodeParameter('uint256', amount);
        await supplyMock.givenCalldataReturn(getCirculatingSupplyAtCached, getCirculatingSupplyAtCachedReturn);
    }

    async function createFtso(symbol: string, initialPriceUSD5Dec: BN) {
        const ftso = await Ftso.new(symbol, wflr.address, ftsoManager, supplyMock.address, 0, 0, 0, initialPriceUSD5Dec, 1e10);
        await ftsoRegistry.addFtso(ftso.address, { from: ftsoManager });
        // both turnout thresholds are set to 0 to match whitelist vp calculation (which doesn't use turnout)
        await ftso.configureEpochs(1, 1, 1000, 10000, 0, 0, [], { from: ftsoManager });
        await ftso.activateFtso(priceSubmitter.address, 0, 120, 60, { from: ftsoManager });
        return ftso;
    }

    async function initializeEpochForReveal(vpBlock?: number, flrSupply: number = 10_000) {
        // set votepower block
        vpBlockNumber = vpBlock ?? await web3.eth.getBlockNumber();
        const ftsoAddrList = await ftsoRegistry.getFtsos();
        const ftsoList = await Promise.all(ftsoAddrList.map(addr => Ftso.at(addr)));
        for (const ftso of ftsoList) {
            await ftso.setVotePowerBlock(vpBlockNumber, { from: ftsoManager });
        }
        await setFlrSupply(flrSupply, vpBlockNumber);
        // initial reveal
        for (const ftso of ftsoList) {
            await ftso.initializeCurrentEpochStateForReveal(false, { from: ftsoManager });
        }
    }
    
    describe("Simple flr with 2 ftso tests", async () => {
        let fxrp: VPTokenMockInstance;
        let fbtc: VPTokenMockInstance;

        let xrpFtso: MockFtsoInstance;
        let btcFtso: MockFtsoInstance;

        beforeEach(async () => {
            priceSubmitter = await MockContract.new();
            // create registry
            ftsoRegistry = await FtsoRegistry.new(governance);
            await ftsoRegistry.setFtsoManagerAddress(ftsoManager, { from: governance });
            // create assets
            wflr = await WFlr.new(governance);
            await setDefaultVPContract(wflr, governance);
            fxrp = await VPToken.new(governance, "Ripple", "XRP");
            await setDefaultVPContract(fxrp, governance);
            fbtc = await VPToken.new(governance, "Bitcoin", "BTC");
            await setDefaultVPContract(fbtc, governance);
            // create supply
            supplyInterface = await Supply.new(governance, constants.ZERO_ADDRESS, governance, 10_000, 0, []);
            supplyMock = await MockContract.new();
            // create ftsos
            flrFtso = await createFtso("FLR", usd(1));
            xrpFtso = await createFtso("XRP", usd(0.5));
            btcFtso = await createFtso("BTC", usd(5));
            await xrpFtso.setFAsset(fxrp.address, { from: ftsoManager });
            await btcFtso.setFAsset(fbtc.address, { from: ftsoManager });
            await flrFtso.setFAssetFtsos([xrpFtso.address, btcFtso.address], { from: ftsoManager });
            // create whitelist
            whitelist = await VoterWhitelister.new(governance, priceSubmitter.address, 5);
            await whitelist.mockSetFtsoRegistry(ftsoRegistry.address);
            await whitelist.mockAddFtso(0);
            await whitelist.mockAddFtso(1);
            await whitelist.mockAddFtso(2);
        });

        it("get correct parameters", async () => {
            // Assemble
            for (let i = 1; i < 10; i++) {
                await wflr.deposit({ from: accounts[i], value: eth(100 * i) });
                await fxrp.mint(accounts[i], eth(100 * i));
                await fbtc.mint(accounts[i], eth(100 * i));
            }
            await initializeEpochForReveal();
            // Assert
            const result = await xrpFtso.getVoteWeightingParameters();
            const assetMultipliers = result[1].map(fmtNum);
            const totalVotePowerFlr = fmtNum(result[2]);
            const totalVotePowerAsset = fmtNum(result[3]);
            const assetWeightRatio = fmtNum(result[4]);
            compareArrays(assetMultipliers, ['5.000e+16']);
            assert.equal(totalVotePowerFlr, '4.500e+21');
            assert.equal(totalVotePowerAsset, '2.250e+8');
            assert.equal(assetWeightRatio, '5000');
        });

        async function calculateCorrectVotePowers(ftso: MockFtsoInstance) {
            // Assemble
            for (let i = 1; i < 10; i++) {
                await wflr.deposit({ from: accounts[i], value: eth(100 * Math.random()) });
                await fxrp.mint(accounts[i], eth(100 * Math.random()));
                await fbtc.mint(accounts[i], eth(100 * Math.random()));
            }
            await initializeEpochForReveal();
            // Assert
            const { 0: assets, 1: assetMultipliers, 2: totalVotePowerFlr, 3: totalVotePowerAsset, 4: assetWeightRatio, 5: votePowerBlock } =
                await ftso.getVoteWeightingParameters();
            const voters = accounts.slice(1, 5);
            const assetVP = await whitelist.getAssetVotePowerWeights.call(assets, assetMultipliers, totalVotePowerAsset, voters, votePowerBlock);
            // console.log('assetVP', assetVP.map(fmtNum));
            const flareVP = await whitelist.getFlareVotePowerWeights.call(wflr.address, totalVotePowerFlr, voters, votePowerBlock);
            // console.log('flareVP', flareVP.map(fmtNum));
            const combined = await whitelist.getVotePowerWeights.call(ftso.address, voters);
            // console.log('Combined', combined.map(fmtNum));
            // from ftso
            const ftsoVPFlr: BN[] = [];
            const ftsoVPAsset: BN[] = [];
            for (const voter of voters) {
                const vp = await ftso.getVotePowerOf.call(voter);
                ftsoVPFlr.push(vp[0]);
                ftsoVPAsset.push(vp[1]);
            }
            // console.log('ftsoVPAsset', ftsoVPAsset.map(fmtNum));
            // console.log('ftsoVPFlr', ftsoVPFlr.map(fmtNum));
            const ftsoVPCombined = await ftso.getVotePowerWeights.call(voters);
            // console.log('ftsoVPCombined', ftsoVPCombined.map(fmtNum));
            compareArrays(ftsoVPCombined.map(fmtNum), combined.map(fmtNum));
        }

        it("calculates correct vote powers (FLR)", async () => {
            await calculateCorrectVotePowers(flrFtso);
        });

        it("calculates correct vote powers (XRP)", async () => {
            await calculateCorrectVotePowers(xrpFtso);
        });

        it("calculations work with zeros", async () => {
            // Assemble
            await initializeEpochForReveal();
            // Act
            const voters = accounts.slice(1, 5);
            const assetVP = await whitelist.getAssetVotePowerWeights.call([constants.ZERO_ADDRESS], [0], 10, voters, vpBlockNumber);
            // console.log('assetVP', assetVP.map(fmtNum));
            const flareVP = await whitelist.getFlareVotePowerWeights.call(wflr.address, 10, voters, vpBlockNumber);
            // console.log('flareVP', flareVP.map(fmtNum));
            const combined = await whitelist.getVotePowerWeights.call(xrpFtso.address, voters);
            // Assert
            compareArrays(assetVP.map(x => x.toNumber()), [0, 0, 0, 0]);
            compareArrays(flareVP.map(x => x.toNumber()), [0, 0, 0, 0]);
            compareArrays(combined.map(x => x.toNumber()), [0, 0, 0, 0]);
        });

        async function init10Voters() {
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
                await fbtc.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            return voters;
        }

        it("add accounts to the whitelist (flr, simple)", async () => {
            // Assemble
            const ftsoIndex = 0;    // flr
            const voters = await init10Voters();
            // Act
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add accounts to the whitelist (xrp, simple)", async () => {
            // Assemble
            const ftsoIndex = 1;    // xrp
            const voters = await init10Voters();
            // Act
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("adding accounts twice changes nothing", async () => {
            // Assemble
            const ftsoIndex = 0;    // flr
            const voters = await init10Voters();
            // Act
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add works even if assets have no votepower", async () => {
            // Assemble
            const ftsoIndex = 0;    // flr
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
            }
            await initializeEpochForReveal();
            // Act
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add works for assetless ftsos", async () => {
            // Assemble
            const xyzFtso = await createFtso("XYZ", usd(2));
            const ftsoIndex = await ftsoRegistry.getFtsoIndex(await xyzFtso.symbol());
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 5, { from: governance });
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("add works even if assets have no flare votepower", async () => {
            // Assemble
            const ftsoIndex = 0;    // flr
            const voters = accounts.slice(1, 11);
            const votePowers = [2, 8, 4, 5, 9, 1, 10, 3, 6, 7];
            for (let i = 0; i < 10; i++) {
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            // Act
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [6, 1, 8, 9, 4]);
        });

        it("change whitelist size", async () => {
            // Assemble
            const ftsoIndex = 0;    // flr
            const voters = await init10Voters();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 5, { from: governance });
            for (const voter of voters.slice(0, 6)) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            await whitelist.setMaxVotersForFtso(ftsoIndex, 10, { from: governance });
            for (const voter of voters.slice(6)) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [0, 1, 2, 3, 4, 6, 7, 8, 9]);
        });

        it("decrease whitelist size", async () => {
            // Assemble
            const ftsoIndex = 0;    // flr
            const voters = await init10Voters();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 10, { from: governance });
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            await whitelist.setMaxVotersForFtso(ftsoIndex, 5, { from: governance });
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            compareArrays(wlind, [8, 1, 6, 9, 4]);
        });

        it("can change default whitelist size", async () => {
            // Assemble
            const xyzFtso = await createFtso("XYZ", usd(2));
            const xyzFtsoIndex = await ftsoRegistry.getFtsoIndex(await xyzFtso.symbol());
            const abcFtso = await createFtso("ABC", usd(3));
            const abcFtsoIndex = await ftsoRegistry.getFtsoIndex(await abcFtso.symbol());
            // Act
            await whitelist.setDefaultMaxVotersForFtso(15, { from: governance });
            await whitelist.mockAddFtso(xyzFtsoIndex);
            await whitelist.setDefaultMaxVotersForFtso(32, { from: governance });
            await whitelist.mockAddFtso(abcFtsoIndex);
            // Assert
            assertNumberEqual(await whitelist.maxVotersForFtso(xyzFtsoIndex), 15);
            assertNumberEqual(await whitelist.maxVotersForFtso(abcFtsoIndex), 32);
        });

        it("remove whitelist", async () => {
            // Assemble
            const ftsoIndex = 0;    // flr
            const voters = await init10Voters();
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, 10, { from: governance });
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            assertNumberEqual(await whitelist.maxVotersForFtso(ftsoIndex), 10);
            await whitelist.mockRemoveFtso(ftsoIndex);
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            compareArrays(wl, []);  // whitelist must be empty now
            assertNumberEqual(await whitelist.maxVotersForFtso(ftsoIndex), 0);
            await expectRevert(whitelist.requestWhitelistingVoter(voters[0], ftsoIndex),
                "max voters not set for ftso");
        });

        it("only price submitter can add or remove ftso and set registry", async () => {
            // Assert
            await expectRevert(whitelist.addFtso(0, { from: accounts[1] }),
                "only price submitter");
            await expectRevert(whitelist.removeFtso(0, { from: accounts[1] }),
                "only price submitter");
            await expectRevert(whitelist.setFtsoRegistry(ftsoRegistry.address, { from: accounts[1] }),
                "only price submitter");
        });

        it("only governance can change whitelist sizes", async () => {
            // Assert
            await expectRevert(whitelist.setMaxVotersForFtso(0, 10, { from: accounts[1] }),
                "only governance");
            await expectRevert(whitelist.setDefaultMaxVotersForFtso(10, { from: accounts[1] }),
                "only governance");
        });

        it("should only throw out if strictly greater", async () => {
            const ftsoIndex = 0;    // flr

            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            await whitelist.setMaxVotersForFtso(ftsoIndex, 2, { from: governance });
            for (let i = 0; i < 3; ++i) {
                await whitelist.requestWhitelistingVoter(voters[i], ftsoIndex);
            }
            let wl = await whitelist.getWhitelist(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1]); // 2 should not throw out anyone

            await whitelist.setMaxVotersForFtso(ftsoIndex, 3, { from: governance });

            for (let i = 0; i < 5; ++i) {
                await whitelist.requestWhitelistingVoter(voters[i], ftsoIndex);
            }

            wl = await whitelist.getWhitelist(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 4]);

            await whitelist.setMaxVotersForFtso(ftsoIndex, 4, { from: governance });
            await whitelist.requestWhitelistingVoter(voters[3], ftsoIndex);

            wl = await whitelist.getWhitelist(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 4, 3]);
        });

        it("should only list once per address", async () => {
            const ftsoIndex = 0;    // flr

            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();

            await whitelist.setMaxVotersForFtso(ftsoIndex, 3, { from: governance });

            let tx = await whitelist.requestWhitelistingVoter(voters[3], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: voters[3], ftsoIndex: eth(ftsoIndex) });
            tx = await whitelist.requestWhitelistingVoter(voters[3], ftsoIndex);
            expectEvent.notEmitted(tx, "VoterWhitelisted");

            let wl = await whitelist.getWhitelist(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [3]); // Should not be added twice
            // At least 2 more should be added 

            tx = await whitelist.requestWhitelistingVoter(voters[5], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: voters[5], ftsoIndex: eth(ftsoIndex) });
            tx = await whitelist.requestWhitelistingVoter(voters[4], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: voters[4], ftsoIndex: eth(ftsoIndex) });

            wl = await whitelist.getWhitelist(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [3, 5, 4]);

            tx = await whitelist.requestWhitelistingVoter(voters[6], ftsoIndex);
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[3], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterWhitelisted", { voter: voters[6], ftsoIndex: eth(ftsoIndex) });

            wl = await whitelist.getWhitelist(ftsoIndex);
            wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [6, 5, 4]);
        });

        it("should work with zero total power flr", async () => {
            const ftsoIndex = 0;    // flr
            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power, but nothing to fasset
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(0, 1, { from: governance });
            let tx = await whitelist.requestWhitelistingVoter(accounts[10], ftsoIndex);
            expectEvent(tx, "VoterWhitelisted", { voter: accounts[10], ftsoIndex: eth(ftsoIndex) });
            tx = await whitelist.requestWhitelistingVoter(accounts[11], ftsoIndex);
            expectEvent.notEmitted(tx, "VoterWhitelisted");
        });

        it("should work with zero total power fasset", async () => {
            const ftsoIndex = 0;    // flr
            const votePowers = [10, 10, 10, 10, 12, 12, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting power, but no flare
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(0, 1, { from: governance });
            await whitelist.requestWhitelistingVoter(accounts[10], ftsoIndex);
            await whitelist.requestWhitelistingVoter(accounts[11], ftsoIndex);
        });

        it("should emit on kicking out", async () => {
            const ftsoIndex = 0;    // flr
            const votePowers = [15, 8, 14, 10, 12, 11, 13];
            const voters = accounts.slice(1, votePowers.length + 1);
            for (let i = 0; i < voters.length; i++) {
                // Give each one some voting
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
                await fxrp.mint(voters[i], eth(votePowers[i]));
            }
            await initializeEpochForReveal();
            // Act
            await whitelist.setMaxVotersForFtso(0, 7, { from: governance });

            for (let i = 0; i < 7; ++i) {
                const tx = await whitelist.requestWhitelistingVoter(voters[i], ftsoIndex);
                expectEvent(tx, "VoterWhitelisted", { voter: voters[i], ftsoIndex: eth(ftsoIndex) });
            }

            let wl = await whitelist.getWhitelist(ftsoIndex);
            let wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, [0, 1, 2, 3, 4, 5, 6]);

            let tx = await whitelist.setMaxVotersForFtso(0, 5, { from: governance });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[1], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[3], ftsoIndex: eth(ftsoIndex) });

            await whitelist.setMaxVotersForFtso(0, 6, { from: governance });
            tx = await whitelist.setMaxVotersForFtso(0, 2, { from: governance });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[5], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[4], ftsoIndex: eth(ftsoIndex) });
            expectEvent(tx, "VoterRemovedFromWhitelist", { voter: voters[6], ftsoIndex: eth(ftsoIndex) });

        });
    });

    describe.skip("Benchmarking flr with 5 ftso tests", async () => {
        let assetData: Array<[name: string, symbol: string, price: BN]> = [
            ["Ripple", "XRP", usd(0.5)],
            ["Bitcoin", "BTC", usd(5)],
            ["Ethereum", "ETH", usd(2)],
            ["Dodge", "DOGE", usd(0.2)],
            ["Polkadot", "DOT", usd(1.5)],
        ]

        let assets: VPTokenMockInstance[];
        let ftsos: MockFtsoInstance[];

        beforeEach(async () => {
            // create registry
            ftsoRegistry = await FtsoRegistry.new(governance);
            await ftsoRegistry.setFtsoManagerAddress(ftsoManager, { from: governance });
            // create assets
            wflr = await WFlr.new(governance);
            await setDefaultVPContract(wflr, governance);
            assets = [];
            for (const [name, symbol, _] of assetData) {
                const asset = await VPToken.new(governance, name, symbol);
                await setDefaultVPContract(asset, governance);
                assets.push(asset);
            }
            // create supply
            supplyInterface = await Supply.new(governance, constants.ZERO_ADDRESS, governance, 10_000, 0, []);
            supplyMock = await MockContract.new();
            // create ftsos
            flrFtso = await createFtso("FLR", usd(1));
            ftsos = [];
            for (let i = 0; i < assets.length; i++) {
                const [_, symbol, price] = assetData[i];
                const ftso = await createFtso(symbol, price);
                await ftso.setFAsset(assets[i].address, { from: ftsoManager });
                ftsos.push(ftso);
            }
            await flrFtso.setFAssetFtsos(ftsos.map(f => f.address), { from: ftsoManager });
            // create whitelist
            whitelist = await VoterWhitelister.new(governance, priceSubmitter.address, 10);
            await whitelist.mockSetFtsoRegistry(ftsoRegistry.address);
        });

        async function addAccountsToWhitelist(ftsoIndex: number, maxWhitelistLength: number, votePowers: number[]) {
            // Assemble
            const voters = accounts.slice(100, 100 + votePowers.length);
            for (let i = 0; i < votePowers.length; i++) {
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
                for (const asset of assets) {
                    await asset.mint(voters[i], eth(votePowers[i]));
                }
            }
            await whitelist.setMaxVotersForFtso(ftsoIndex, maxWhitelistLength, { from: governance });
            await initializeEpochForReveal();
            // warm cache
            for (const voter of voters) {
                for (const asset of assets) {
                    await asset.votePowerOfAtCached(voter, vpBlockNumber);
                }
            }
            // Act
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // simulate
            const simVoters = Array.from({ length: voters.length }, (_, i) => i);
            const simList: number[] = [];
            for (const voter of simVoters) {
                if (simList.length < maxWhitelistLength) {
                    simList.push(voter);
                } else {
                    let minIndex = 0;
                    for (let i = 0; i < simList.length; i++) {
                        if (votePowers[simList[i]] <= votePowers[simList[minIndex]]) {
                            minIndex = i;
                        }
                    }
                    if (votePowers[simList[minIndex]] < votePowers[voter]) {
                        simList[minIndex] = voter;
                    }
                }
            }
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            compareArrays(wlind, simList);
        }

        it("add accounts to the whitelist (FLR)", async () => {
            const votePowers = Array.from({ length: 200 }, (_, i) => Math.random() * 100);
            await addAccountsToWhitelist(0, 100, votePowers);
        });

        it("add accounts to the whitelist (XRP)", async () => {
            const votePowers = Array.from({ length: 200 }, (_, i) => Math.random() * 100);
            await addAccountsToWhitelist(1, 100, votePowers);
        });

        async function batchReadVotepowers(batchSize: number, cached: boolean) {
            // Assemble
            const votePowers = Array.from({ length: batchSize }, (_, i) => Math.random() * 100);
            const voters = accounts.slice(100, 100 + votePowers.length);
            for (let i = 0; i < votePowers.length; i++) {
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
                for (const asset of assets) {
                    await asset.mint(voters[i], eth(votePowers[i]));
                }
            }
            const allAssets = [wflr, ...assets];
            await initializeEpochForReveal();
            // Act
            if (cached) {
                for (const voter of voters) {
                    for (const asset of allAssets) {
                        await asset.votePowerOfAtCached(voter, vpBlockNumber);
                    }
                }
            }
            // Assert
            for (const asset of allAssets) {
                await whitelist.getVotePowers(asset.address, voters, vpBlockNumber);
            }
        }

        it("batch read the votepowers (non-cached)", async () => {
            await batchReadVotepowers(100, false);
        });

        it("batch read the votepowers (cached)", async () => {
            await batchReadVotepowers(100, true);
        });

        async function decreaseWhitelistLength(ftsoIndex: number, maxWhitelistLength: number, minWhitelistLength: number, votePowers: number[]) {
            // Assemble
            const voters = accounts.slice(100, 100 + votePowers.length);
            for (let i = 0; i < votePowers.length; i++) {
                await wflr.deposit({ from: voters[i], value: eth(votePowers[i]) });
                for (const asset of assets) {
                    await asset.mint(voters[i], eth(votePowers[i]));
                }
            }
            await whitelist.setMaxVotersForFtso(ftsoIndex, maxWhitelistLength, { from: governance });
            await initializeEpochForReveal();
            // warm cache
            for (const voter of voters) {
                for (const asset of assets) {
                    await asset.votePowerOfAtCached(voter, vpBlockNumber);
                }
            }
            for (const voter of voters) {
                await whitelist.requestWhitelistingVoter(voter, ftsoIndex);
            }
            // Act
            await whitelist.setMaxVotersForFtso(ftsoIndex, minWhitelistLength, { from: governance });
            // simulate
            const simVoters = Array.from({ length: voters.length }, (_, i) => i);
            const pairs = simVoters.map((v, i) => [v, votePowers[i]] as const);
            pairs.sort((a, b) => b[1] - a[1]);  // sort decreasing
            pairs.splice(minWhitelistLength, pairs.length - minWhitelistLength);
            const simList = pairs.map(p => p[0]);
            // Assert
            const wl = await whitelist.getWhitelist(ftsoIndex);
            const wlind = wl.map(x => voters.indexOf(x));
            // console.log(wlind);
            // console.log(simList);
            compareSets(wlind, simList);
        }

        it("decrease whitelist size (flr)", async () => {
            const votePowers = Array.from({ length: 100 }, (_, i) => Math.random() * 100);
            await decreaseWhitelistLength(0, 100, 50, votePowers);
        });

        it("decrease whitelist size (xrp)", async () => {
            const votePowers = Array.from({ length: 100 }, (_, i) => Math.random() * 100);
            await decreaseWhitelistLength(1, 100, 50, votePowers);
        });
    });
});
