import { FtsoContract, MockContractContract, MockContractInstance, MockFtsoInstance, SupplyContract, SupplyInstance, VPTokenContract, VPTokenInstance, WFlrContract, WFlrInstance } from "../../../../typechain-truffle";
import { compareArrays, compareNumberArrays, computeVoteRandom, increaseTimeTo, isAddressEligible, submitPriceHash, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { defaultPriceEpochCyclicBufferSize, GOVERNANCE_GENESIS_ADDRESS, getTestFile } from "../../../utils/constants";

import {constants, expectRevert, expectEvent, time} from '@openzeppelin/test-helpers';

const Wflr = artifacts.require("WFlr") as WFlrContract;
const MockWflr = artifacts.require("MockContract") as MockContractContract;
const VpToken = artifacts.require("VPToken") as VPTokenContract;
const MockVpToken = artifacts.require("MockContract") as MockContractContract;
const Supply = artifacts.require("Supply") as SupplyContract;
const MockSupply = artifacts.require("MockContract") as MockContractContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const MockFtsoFull = artifacts.require("MockFtso");
const MockFtso = artifacts.require("MockContract") as MockContractContract;

// contains a fresh contract for each test 
let wflrInterface: WFlrInstance;
let mockWflr: MockContractInstance;
let vpTokenInterface: VPTokenInstance;
let mockVpToken: MockContractInstance;
let supplyInterface: SupplyInstance;
let mockSupply: MockContractInstance;
let ftso: MockFtsoInstance;
let epochId: number;

// multi faseet ftsos
let mockFtsos: MockContractInstance[];
let mockVpTokens: MockContractInstance[];


// WARNING: using givenMethodReturn instead of givenCalldataReturn may cause problems
// there was a bug in FTSO.flrVotePowerCached which used wrong votePowerBlock, but all tests pass before the change
async function setMockVotePowerAt(blockNumber: number, wflrVotePower: number, fassetVotePower: number) {
    const votePowerAtCached_wflr = wflrInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
    const votePowerAtCachedReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenCalldataReturn(votePowerAtCached_wflr, votePowerAtCachedReturn_wflr);

    const getCirculatingSupplyAtCached = supplyInterface.contract.methods.getCirculatingSupplyAtCached(blockNumber).encodeABI();
    const getCirculatingSupplyAtCachedReturn = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockSupply.givenCalldataReturn(getCirculatingSupplyAtCached, getCirculatingSupplyAtCachedReturn);

    const votePowerAtCached_vpToken = vpTokenInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
    const votePowerAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePower);
    await mockVpToken.givenCalldataReturn(votePowerAtCached_vpToken, votePowerAtCachedReturn_vpToken);
}

async function setMockVotePowerOfAt(blockNumber: number, wflrVotePower: number, fassetVotePower: number, address: string) {
    const votePowerOfAtCached_wflr = wflrInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
    const votePowerOfAtCachedReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenCalldataReturn(votePowerOfAtCached_wflr, votePowerOfAtCachedReturn_wflr);
    const votePowerOfAtCached_vpToken = vpTokenInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
    const votePowerOfAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePower);
    await mockVpToken.givenCalldataReturn(votePowerOfAtCached_vpToken, votePowerOfAtCachedReturn_vpToken);
}

async function setMockVotePowerAtMultiple(blockNumber: number, wflrVotePower: number, fassetVotePowers: number[], currentPrices: number[]) {
    const len = fassetVotePowers.length;
    assert(len == mockFtsos.length, "Fasset vote powers length does not match mock Ftso contracts length");
    assert(len == mockVpTokens.length, "Fasset vote powers length does not match mock VPToken contracts length");
    assert(len == currentPrices.length, "Fasset vote powers length does not match current prices length");
    const votePowerAtCached_wflr = wflrInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
    const votePowerAtCachedReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenCalldataReturn(votePowerAtCached_wflr, votePowerAtCachedReturn_wflr);

    const getCirculatingSupplyAtCached = supplyInterface.contract.methods.getCirculatingSupplyAtCached(blockNumber).encodeABI();
    const getCirculatingSupplyAtCachedReturn = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockSupply.givenCalldataReturn(getCirculatingSupplyAtCached, getCirculatingSupplyAtCachedReturn);

    for (let i = 0; i < len; i++) {
        const votePowerAtCached_vpToken = vpTokenInterface.contract.methods.totalVotePowerAtCached(blockNumber).encodeABI();
        const votePowerAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePowers[i]);
        await mockVpTokens[i].givenCalldataReturn(votePowerAtCached_vpToken, votePowerAtCachedReturn_vpToken);

        const fasset_ftso = ftso.contract.methods.getFAsset().encodeABI();
        const fassetReturn_ftso = web3.eth.abi.encodeParameter('address', mockVpTokens[i].address);
        await mockFtsos[i].givenCalldataReturn(fasset_ftso, fassetReturn_ftso);

        const currentPrice_ftso = ftso.contract.methods.getCurrentPrice().encodeABI();
        const currentPriceReturn_ftso = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [currentPrices[i], 1]);
        await mockFtsos[i].givenCalldataReturn(currentPrice_ftso, currentPriceReturn_ftso);
    }
}

async function setMockVotePowerOfAtMultiple(blockNumber: number, wflrVotePower: number, fassetVotePowers: number[], address: string) {
    const len = fassetVotePowers.length;
    assert(len == mockVpTokens.length, "Fasset vote powers length does not match mock VPToken contracts length");
    const votePowerOfAtCached_wflr = wflrInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
    const votePowerOfAtCachedReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenCalldataReturn(votePowerOfAtCached_wflr, votePowerOfAtCachedReturn_wflr);
    for (let i = 0; i < len; i++) {
        const votePowerOfAtCached_vpToken = vpTokenInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
        const votePowerOfAtCachedReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePowers[i]);
        await mockVpTokens[i].givenCalldataReturn(votePowerOfAtCached_vpToken, votePowerOfAtCachedReturn_vpToken);
    }
}

contract(`Ftso.sol; ${getTestFile(__filename)}; Ftso unit tests`, async accounts => {

    describe("initialize and configure", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );
        });

        it("Should activate ftso", async() => {
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});
            let hash = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash, {from: accounts[1]}), "PriceHashSubmitted");
        });

        it("Should not activate ftso if not ftso manager", async() => {
            await expectRevert(ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[1]}), "Access denied");
            let hash = submitPriceHash(500, 123, accounts[1]);
            await expectRevert(ftso.submitPriceHash(hash, {from: accounts[1]}), "FTSO not active");
        });

        it("Should know about PriceSubmitter", async() => {
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});
            expect(await ftso.priceSubmitter()).to.equals(accounts[4]);
        });

        it("Should not activate ftso if already activated", async() => {
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});
            await expectRevert(ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]}), "FTSO already activated");
            await expectRevert(ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[1]}), "Access denied");
        });

        it("Should deactivate ftso", async() => {
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});
            expect(await ftso.active()).to.be.true;
            await ftso.deactivateFtso({from: accounts[10]});
            expect(await ftso.active()).to.be.false;
        });

        it("Should not deactivate ftso if not ftso manager", async() => {
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});
            expect(await ftso.active()).to.be.true;
            await expectRevert(ftso.deactivateFtso({from: accounts[1]}), "Access denied");
            expect(await ftso.active()).to.be.true;
        });

        it("Should not deactivate ftso if already deactivated", async() => {
            await expectRevert(ftso.deactivateFtso({from: accounts[10]}), "FTSO not active");
            await expectRevert(ftso.deactivateFtso({from: accounts[1]}), "FTSO not active");
        });

        it("Should update initial price", async() => {
            await ftso.updateInitialPrice(900, 5000, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});
            let data = await ftso.getCurrentPrice();
            expect(data[0].toNumber()).to.equals(900);
            expect(data[1].toNumber()).to.equals(5000);
        });

        it("Should not update initial price if not ftso manager", async() => {
            await expectRevert(ftso.updateInitialPrice(500, 8000, {from: accounts[1]}), "Access denied");
        });

        it("Should not update initial price if already activated", async() => {
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});
            await expectRevert(ftso.updateInitialPrice(900, 3000, {from: accounts[10]}), "FTSO already activated");
            expect((await ftso.getCurrentPrice())[0].toNumber()).to.equals(1);
        });

        it("Should revert at submit price if not activated", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            await expectRevert(ftso.submitPriceHash(hash, {from: accounts[1]}), "FTSO not active");
            await expectRevert(ftso.submitPriceHashSubmitter(accounts[0], hash, {from: accounts[4]}), "FTSO not active");
        });

        it("Should revert at reveal price if not activated", async() => {
            await expectRevert(ftso.revealPrice(1, 500, 123, {from: accounts[1]}), "FTSO not active");
            await expectRevert(ftso.revealPriceSubmitter(accounts[0], 1, 500, 123, 100, {from: accounts[4]}), "FTSO not active");
        });

        it("Should configure epochs", async() => {
            await ftso.configureEpochs(20, 30, 400, 800, 500, 500, [], {from: accounts[10]});
        });

        it("Should not configure epochs ftso if not ftso manager", async() => {
            await expectRevert(ftso.configureEpochs(20, 20, 200, 800, 500, 500, [], {from: accounts[1]}), "Access denied");
        });

        it("Should set vote power block", async() => {
            await ftso.setVotePowerBlock(20, {from: accounts[10]});
        });

        it("Should not set vote power block if not ftso manager", async() => {
            await expectRevert(ftso.setVotePowerBlock(20, {from: accounts[1]}), "Access denied");
        });

        it("Should set fasset", async() => {
            await ftso.setFAsset(mockVpToken.address, {from: accounts[10]});
            expect(await ftso.fAssetFtsos(0)).to.equals(ftso.address);
            await expectRevert.unspecified(ftso.fAssetFtsos(1));
            expect(await ftso.fAssets(0)).to.equals(mockVpToken.address);
            await expectRevert.unspecified(ftso.fAssets(1));
        });

        it("Should not set fasset if not ftso manager", async() => {
            await expectRevert(ftso.setFAsset(mockVpToken.address, {from: accounts[1]}), "Access denied");
        });

        it("Should not get fasset ftsos if not multi fasset ftsos", async() => {
            await ftso.setFAsset(mockVpToken.address, {from: accounts[10]});
            let addresses: string[] = await ftso.getFAssetFtsos();
            expect(addresses.length).to.equals(0);
        });
    });

    describe("min/max vote power threshold", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new(accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            await ftso.setFAsset(mockVpToken.address, {from: accounts[10]});
            // await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.configureEpochs(50, 50, 1000, 10000, 50, 15, [], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should change vote power to allowed max threshold", async() => {
            // round 1 - current fasset price = 0
            let hash = submitPriceHash(250, 123, accounts[1]);
            await ftso.submitPriceHash(hash, {from: accounts[1]});
            await setMockVotePowerAt(10, 100000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 21000, 0, accounts[1]);
            await ftso.revealPrice(epochId, 250, 123, {from: accounts[1]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", 
                {epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250),  finalizationType: toBN(1)});
            
            let votesDataFlr = await ftso.getEpochVotes(epochId);
            expect(votesDataFlr[0]).to.eqls([accounts[1]]);
            expect(votesDataFlr[1]).to.eqls([toBN(250)]);
            expect(votesDataFlr[2]).to.eqls([toBN(1000000000000)]);
            expect(votesDataFlr[3]).to.eqls([toBN(20000000000)]);
            expect(votesDataFlr[4]).to.eqls([toBN(0)]);
            expect(votesDataFlr[5]).to.eqls([true]);            
            
            // round 2 - current fasset price = 250
            await ftso.configureEpochs(50, 50, 1000, 10000, 50, 15, [], {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});

            let hash1 = submitPriceHash(500, 123, accounts[1]);
            await ftso.submitPriceHash(hash1, {from: accounts[1]});
            
            await setMockVotePowerAt(12, 100000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 0, 21000, accounts[1]); 
            await ftso.revealPrice(epochId+1, 500, 123, {from: accounts[1]});
            
            let votesDataAsset = await ftso.getEpochVotes(epochId+1);
            expect(votesDataAsset[0]).to.eqls([accounts[1]]);
            expect(votesDataAsset[1]).to.eqls([toBN(500)]);
            expect(votesDataAsset[2]).to.eqls([toBN(1000000000000)]);
            expect(votesDataAsset[3]).to.eqls([toBN(0)]);
            expect(votesDataAsset[4]).to.eqls([toBN(20000000000)]);
            expect(votesDataAsset[5]).to.eqls([false]);
        });
    })

    describe("submit and reveal price", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            await ftso.setFAsset(mockVpToken.address, {from: accounts[10]});
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should submit price", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
        });

        it("Should submit price multiple times", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash1, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash1});

            let hash2 = submitPriceHash(500, 124, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash2, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash2});

            let hash3 = submitPriceHash(500, 125, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash3, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash3});
        });

        it("Should submit price multiple times - different users", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash1, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash1});

            let hash2 = submitPriceHash(250, 124, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash2, {from: accounts[2]}), "PriceHashSubmitted", {submitter: accounts[2], epochId: toBN(epochId), hash: hash2});

            let hash3 = submitPriceHash(400, 125, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash3, {from: accounts[3]}), "PriceHashSubmitted", {submitter: accounts[3], epochId: toBN(epochId), hash: hash3});
        });

        it("Should submit price (submitter)", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHashSubmitter(accounts[1], hash, {from: accounts[4]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
        });

        it("Should not submit price (submitter) if not from submitter", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            await expectRevert(ftso.submitPriceHashSubmitter(accounts[1], hash, {from: accounts[2]}), "Access denied");
        });

        it("Should initialize epoch state for reveal", async() => {
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
        });

        it("Should not initialize epoch state for reveal if not ftso manager", async() => {
            await expectRevert(ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[1]}), "Access denied");
        });

        it("Should reveal price", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
            expectEvent(await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500), random: toBN(123)});
        });

        it("Should reveal price - different users", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash1, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash1});
            let hash2 = submitPriceHash(250, 124, accounts[2]);
            expectEvent(await ftso.submitPriceHash(hash2, {from: accounts[2]}), "PriceHashSubmitted", {submitter: accounts[2], epochId: toBN(epochId), hash: hash2});
            let hash3 = submitPriceHash(400, 125, accounts[3]);
            expectEvent(await ftso.submitPriceHash(hash3, {from: accounts[3]}), "PriceHashSubmitted", {submitter: accounts[3], epochId: toBN(epochId), hash: hash3});
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
            expectEvent(await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500), random: toBN(123)});
            await setMockVotePowerOfAt(10, 10, 0, accounts[2]);  // vote power of 0 is not allowed
            expectEvent(await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]}), "PriceRevealed", {voter: accounts[2], epochId: toBN(epochId), price: toBN(250), random: toBN(124)});
            await setMockVotePowerOfAt(10, 10, 0, accounts[3]);  // vote power of 0 is not allowed
            expectEvent(await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]}), "PriceRevealed", {voter: accounts[3], epochId: toBN(epochId), price: toBN(400), random: toBN(125)});
        });

        it("Should reveal price for last submitted hash only", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash1, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash1});
            let hash2 = submitPriceHash(500, 124, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash2, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash2});
            let hash3 = submitPriceHash(500, 125, accounts[1]);
            expectEvent(await ftso.submitPriceHash(hash3, {from: accounts[1]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash3});
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            
            await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price already revealed or not valid");
            await expectRevert(ftso.revealPrice(epochId, 500, 124, {from: accounts[1]}), "Price already revealed or not valid");
            expectEvent(await ftso.revealPrice(epochId, 500, 125, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500), random: toBN(125)});
        });

        it("Should reveal price (submitter)", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHashSubmitter(accounts[1], hash, {from: accounts[4]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});

            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
            expectEvent(await ftso.revealPriceSubmitter(accounts[1], epochId, 500, 123, 10, {from: accounts[4]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500), random: toBN(123)});
        });

        it("Should not reveal price (submitter) if not from submitter", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            expectEvent(await ftso.submitPriceHashSubmitter(accounts[1], hash, {from: accounts[4]}), "PriceHashSubmitted", {submitter: accounts[1], epochId: toBN(epochId), hash: hash});

            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
            await expectRevert(ftso.revealPriceSubmitter(accounts[1], epochId, 500, 123, 10, {from: accounts[1]}), "Access denied");
        });

        it("Should reveal prices from trusted addresses for epoch in fallback mode", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[6]), {from: accounts[6]});
            await ftso.submitPriceHash(submitPriceHash(500, 126, accounts[7]), {from: accounts[7]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(true, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Epoch not initialized for reveal");
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await expectRevert(ftso.revealPrice(epochId, 250, 124, {from: accounts[2]}), "Epoch not initialized for reveal");
            await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[6]});
            await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
            await ftso.revealPrice(epochId, 500, 126, {from: accounts[7]});
        });

        it("Should not reveal price before submit period is over", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            await ftso.submitPriceHash(hash, {from: accounts[1]});
            await increaseTimeTo((epochId + 1) * 120 - 2);
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Reveal period not active");
        });

        it("Should not reveal price after reveal period is over", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            await ftso.submitPriceHash(hash, {from: accounts[1]});
            await increaseTimeTo((epochId + 1) * 120 + 60 - 1);
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Reveal period not active");
        });

        it("Should not reveal price twice", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            await ftso.submitPriceHash(hash, {from: accounts[1]});
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 0, accounts[1]);  // vote power of 0 is not allowed
            expectEvent(await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500), random: toBN(123)});
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price already revealed or not valid");
        });

        it("Should not reveal price if epoch is not initialized", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            await ftso.submitPriceHash(hash, {from: accounts[1]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Epoch not initialized for reveal");
        });

        it("Should not reveal price if submit price was not called", async() => {
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price already revealed or not valid");
        });

        it("Should not reveal price if hash and price+random do not match", async() => {
            let hash = submitPriceHash(500, 123, accounts[1]);
            await ftso.submitPriceHash(hash, {from: accounts[1]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, 500, 125, {from: accounts[1]}), "Price already revealed or not valid");
        });

        it("Should not reveal price if price is too high", async() => {
            let price = toBN(2).pow(toBN(128));
            let hash = submitPriceHash(price, 123, accounts[1]);
            await ftso.submitPriceHash(hash, {from: accounts[1]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, price, 123, {from: accounts[1]}), "Price too high");
        });

        it("Should reduce vote power to max vote power threshold", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", 
                {epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250),  finalizationType: toBN(1)});

            // round 2 - current fasset price = 250
            await ftso.configureEpochs(5, 50, 1000, 10000, 50, 500, [], {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(12, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            //wflr - min 5000, max 10000, fasset - min 10000, max 20000
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 20000, 0, accounts[1]); // reduced to 10000/50000*1e12
            await ftso.revealPrice(epochId+1, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 7500, 15000, accounts[2]);
            await ftso.revealPrice(epochId+1, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 0, 30000, accounts[3]); // reduced to 20000/1000000*1e12
            await ftso.revealPrice(epochId+1, 400, 125, {from: accounts[3]});

            // ok if enough vote power
            let votesData = await ftso.getEpochVotes(epochId+1);
            expect(votesData[0]).to.eqls([accounts[1], accounts[2], accounts[3]]);
            expect(votesData[1]).to.eqls([toBN(500), toBN(250), toBN(400)]);
            expect(votesData[2]).to.eqls([toBN(285714285714), toBN(428571428570), toBN(285714285714)]);
            expect(votesData[3]).to.eqls([toBN(200000000000), toBN(150000000000), toBN(0)]);
            expect(votesData[4]).to.eqls([toBN(0), toBN(15000000000), toBN(20000000000)]);
            expect(votesData[5]).to.eqls([false, false, false]);
        });
    });

    describe("submit and reveal price (without fAsset)", async () => {
        beforeEach(async () => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            const ftso = await Ftso.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [], { from: accounts[10] });
            await ftso.setVotePowerBlock(10, { from: accounts[10] });
            await ftso.activateFtso(accounts[4], 0, 120, 60, { from: accounts[10] });

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

    });

    describe("finalize price", async() => {
    
        beforeEach(async() => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                10000, // price deviation threshold in BIPS (100%)
                defaultPriceEpochCyclicBufferSize
            );

            await ftso.setFAsset(mockVpToken.address, {from: accounts[10]});
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should finalize price epoch - no votes", async() => {
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(0), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(3)});
            
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId + 1, true, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+1), price: toBN(0), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(3)});
        });

        it("Should not finalize more than once", async() => {
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(0), finalizationType: toBN(3)});
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch already finalized");
            await expectRevert(ftso.averageFinalizePriceEpoch(epochId, {from: accounts[10]}), "Epoch already finalized");
            await expectRevert(ftso.forceFinalizePriceEpoch(epochId, {from: accounts[10]}), "Epoch already finalized");

            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId + 1, true, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId+1), price: toBN(0), finalizationType: toBN(3)});
        });

        it("Should finalize price epoch", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1)});
        });

        it("Should finalize price epoch - closestPriceFix test", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(10, 3000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 200, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 200, 10000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(450), rewardedFtso: false, lowRewardPrice: toBN(400), highRewardPrice: toBN(500), finalizationType: toBN(1)});
        });

        it("Should finalize price epoch - two epochs", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1)});

            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+1), price: toBN(300), rewardedFtso: false, lowRewardPrice: toBN(200), highRewardPrice: toBN(400), finalizationType: toBN(1)});
        });

        it("Should finalize price epoch - two epochs with different vote power blocks", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1)});
            
            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+1), price: toBN(400), rewardedFtso: false, lowRewardPrice: toBN(300), highRewardPrice: toBN(400), finalizationType: toBN(1)});
        });

        it("Should finalize price epoch - two epochs - no votes in second one", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1)});

            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            
            // round 2 - current fasset price = 250
            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+1), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(3)});
        });

        it("Should finalize price epoch and return rewarded addresses", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(1);
            expect(data._eligibleAddresses[0]).to.equals(accounts[2]);
            expect(data._flrWeights.length).to.equals(1);
            expect(data._flrWeights[0]).to.equals('100000000000');
            expect(data._flrWeightsSum).to.equals('100000000000');
            await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]});

            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            
            // round 2 - current fasset price = 250
            await increaseTimeTo((epochId + 2) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
            let data2 = await ftso.contract.methods.finalizePriceEpoch(epochId+1, true).call({from: accounts[10]});
            expect(data2._eligibleAddresses.length).to.equals(0);
            expect(data2._flrWeights.length).to.equals(0);
            expect(data2._flrWeightsSum).to.equals('0');
            await ftso.finalizePriceEpoch(epochId+1, true, {from: accounts[10]});

            // round 3 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 3) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 4000, 0, accounts[1]);
            await ftso.revealPrice(epochId+2, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 3000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+2, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+2, 200, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 3) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
            let data3 = await ftso.contract.methods.finalizePriceEpoch(epochId+2, true).call({from: accounts[10]});
            let random = await ftso.getCurrentRandom();
            expect(isAddressEligible(random, accounts[1])).is.true;
            expect(isAddressEligible(random, accounts[2])).is.false;
            expect(data3._eligibleAddresses.length).to.equals(1);
            let id1 = data3._eligibleAddresses.indexOf(accounts[1]);
            let id2 = data3._eligibleAddresses.indexOf(accounts[2]);
            expect(id2).to.equals(-1);
            expect(data3._eligibleAddresses[id1]).to.equals(accounts[1]);
            expect(data3._flrWeights.length).to.equals(1);
            expect(data3._flrWeights[id1]).to.equals('200000000000');
            expect(data3._flrWeightsSum).to.equals('200000000000');
            await ftso.finalizePriceEpoch(epochId+2, true, {from: accounts[10]});
        });

        it("Should not finalize price epoch if not ftso manager", async() => {
            await expectRevert(ftso.finalizePriceEpoch(0, true, {from: accounts[1]}), "Access denied");
        });

        it("Should finalize price epoch using trusted addresses votes if epoch has low flr turnout", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[6]), {from: accounts[6]});
            await ftso.submitPriceHash(submitPriceHash(500, 126, accounts[7]), {from: accounts[7]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[6]});
            await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
            await ftso.revealPrice(epochId, 500, 126, {from: accounts[7]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(0);
            expect(data._flrWeights.length).to.equals(0);
            expect(data._flrWeightsSum).to.equals('0');

            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(450), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(2)});
        });

        it("Should finalize price epoch using trusted addresses votes if epoch has large price deviation", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(5000, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(2500, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(4000, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 5000, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 2500, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 4000, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(2500), rewardedFtso: false, lowRewardPrice: toBN(2500), highRewardPrice: toBN(2500), finalizationType: toBN(1)});

            // round 2 - current fasset price = 2500
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[6]), {from: accounts[6]});
            await ftso.submitPriceHash(submitPriceHash(500, 125, accounts[7]), {from: accounts[7]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[6]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[6]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[7]);
            await ftso.revealPrice(epochId+1, 500, 125, {from: accounts[7]});

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+1), price: toBN(450), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(2)});
        });

        it("Should finalize price epoch using force finalization if epoch has low flr turnout and trusted addresses are not set", async() => {
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [], {from: accounts[10]});
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(0);
            expect(data._flrWeights.length).to.equals(0);
            expect(data._flrWeightsSum).to.equals('0');

            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized", 
                {epochId: toBN(epochId), price: toBN(0), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(3)});
        });

        it("Should finalize price epoch using force finalization if epoch has low flr turnout and no votes from trusted addresses", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(0);
            expect(data._flrWeights.length).to.equals(0);
            expect(data._flrWeightsSum).to.equals('0');

            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized", 
                {epochId: toBN(epochId), price: toBN(0), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(3)});
        });

        it("Should not finalize price epoch for epoch in submit price period", async() => {
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
            await increaseTimeTo((epochId + 1) * 120 - 1); // submit period end -1s
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
        });

        it("Should not finalize price epoch for epoch in reveal price period", async() => {
            await increaseTimeTo((epochId + 1) * 120 - 1); // reveal period start
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
            await increaseTimeTo((epochId + 1) * 120 + 60 - 2); // reveal period end -1s
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
        });

        it("Should not finalize price epoch for epoch in future", async() => {
            await expectRevert(ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "Epoch not ready for finalization");
            await expectRevert(ftso.averageFinalizePriceEpoch(epochId+1, {from: accounts[10]}), "Epoch not ready for finalization");
            await expectRevert(ftso.forceFinalizePriceEpoch(epochId+1, {from: accounts[10]}), "Epoch not ready for finalization");
        });

        it("Should force finalize price epoch using average", async() => {
            expectEvent(await ftso.averageFinalizePriceEpoch(0, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(0), price: toBN(0), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(5)});
        });

        it("Should force finalize price epoch - price timestamp should not change", async() => {
            let priceData = await ftso.getCurrentPrice();
            expectEvent(await ftso.forceFinalizePriceEpoch(0, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(0), price: toBN(0), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(5)});
            let priceData2 = await ftso.getCurrentPrice();
            expect(priceData2[1].toNumber()).to.equals(priceData[1].toNumber());
        });

        it("Should not force finalize using average price epoch if not ftso manager", async() => {
            await expectRevert(ftso.averageFinalizePriceEpoch(0, {from: accounts[1]}), "Access denied");
        });

        it("Should not force finalize price epoch if not ftso manager", async() => {
            await expectRevert(ftso.forceFinalizePriceEpoch(0, {from: accounts[1]}), "Access denied");
        });
    });

    describe("short cyclic FTSO buffer", async() => {
    
        beforeEach(async() => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                10000, // price deviation threshold in BIPS (100%)
                2 // short cyclic buffer
            );

            await ftso.setFAsset(mockVpToken.address, {from: accounts[10]});
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should finalize price epoch - four epochs with different vote power blocks", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(250), rewardedFtso: true, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1)});

            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+1), price: toBN(400), rewardedFtso: false, lowRewardPrice: toBN(300), highRewardPrice: toBN(400), finalizationType: toBN(1)});

            // round 3 
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 3) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+2, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 200, 100, accounts[2]);
            await ftso.revealPrice(epochId+2, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 100000, accounts[3]);
            await ftso.revealPrice(epochId+2, 200, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 3) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+2, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+2), price: toBN(200), rewardedFtso: false, lowRewardPrice: toBN(200), highRewardPrice: toBN(300), finalizationType: toBN(1)});

            // round 4
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 4) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+3, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 200, 100, accounts[2]);
            await ftso.revealPrice(epochId+3, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 100000, accounts[3]);
            await ftso.revealPrice(epochId+3, 200, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 4) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+3, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId+3), price: toBN(200), rewardedFtso: false, lowRewardPrice: toBN(200), highRewardPrice: toBN(300), finalizationType: toBN(1)});
        });
    });

    describe("finalize price (without fAsset)", async () => {
        beforeEach(async () => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [], { from: accounts[10] });
            await ftso.setVotePowerBlock(10, { from: accounts[10] });
            await ftso.activateFtso(accounts[4], 0, 120, 60, { from: accounts[10] });

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should finalize price epoch - two epochs", async () => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
            { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1) });

            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
            await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
                { epochId: toBN(epochId + 1), price: toBN(400), rewardedFtso: false, lowRewardPrice: toBN(400), highRewardPrice: toBN(400), finalizationType: toBN(1) });
        });

        it("Should finalize price epoch - two epochs with different vote power blocks", async () => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            await ftso.setVotePowerBlock(12, { from: accounts[10] });

            // should ignore fAsset amounts
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
                { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1) });

            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            // should ignore fAsset amounts
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
                { epochId: toBN(epochId + 1), price: toBN(300), rewardedFtso: false, lowRewardPrice: toBN(200), highRewardPrice: toBN(400), finalizationType: toBN(1) });
        });

        it("Should finalize price epoch - two epochs - no votes in second one", async () => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), "PriceFinalized",
                { epochId: toBN(epochId), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(250), finalizationType: toBN(1) });

            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            // round 2 - current fasset price = 250
            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }), "PriceFinalized",
                { epochId: toBN(epochId + 1), price: toBN(250), rewardedFtso: false, lowRewardPrice: toBN(0), highRewardPrice: toBN(0), finalizationType: toBN(3) });
        });

        it("Should finalize price epoch and return rewarded addresses", async () => {
            // round 1 - current fasset price = 0
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            await ftso.setVotePowerBlock(12, { from: accounts[10] });

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({ from: accounts[10] });
            expect(data._eligibleAddresses.length).to.equals(1);
            expect(data._eligibleAddresses[0]).to.equals(accounts[2]);
            expect(data._flrWeights.length).to.equals(1);
            expect(data._flrWeights[0]).to.equals('100000000000');
            expect(data._flrWeightsSum).to.equals('100000000000');
            await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] });

            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            // round 2 - current fasset price = 250
            await increaseTimeTo((epochId + 2) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
            let data2 = await ftso.contract.methods.finalizePriceEpoch(epochId + 1, true).call({ from: accounts[10] });
            expect(data2._eligibleAddresses.length).to.equals(0);
            expect(data2._flrWeights.length).to.equals(0);
            expect(data2._flrWeightsSum).to.equals('0');
            await ftso.finalizePriceEpoch(epochId + 1, true, { from: accounts[10] });

            // round 3 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            await increaseTimeTo((epochId + 3) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 4000, 0, accounts[1]);
            await ftso.revealPrice(epochId + 2, 300, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(12, 3000, 80000, accounts[2]);
            await ftso.revealPrice(epochId + 2, 400, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId + 2, 200, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 3) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
            let data3 = await ftso.contract.methods.finalizePriceEpoch(epochId + 2, true).call({ from: accounts[10] });
            expect(data3._eligibleAddresses.length).to.equals(1);
            let id1 = data3._eligibleAddresses.indexOf(accounts[1]);
            let id2 = data3._eligibleAddresses.indexOf(accounts[2]);
            expect(id2).to.equals(-1);
            expect(data3._eligibleAddresses[id1]).to.equals(accounts[1]);
            expect(data3._flrWeights.length).to.equals(1);
            expect(data3._flrWeights[id1]).to.equals('200000000000');
            expect(data3._flrWeightsSum).to.equals('200000000000');
            await ftso.finalizePriceEpoch(epochId + 2, true, { from: accounts[10] });
        });
    });

    describe("getters", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            await ftso.setFAsset(mockVpToken.address, {from: accounts[10]});
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should get price epoch configuration", async() => {
            let data = await ftso.getPriceEpochConfiguration();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(120);
            expect(data[2].toNumber()).to.equals(60);
        });

        it("Should get epochs configuration", async() => {
            await ftso.configureEpochs(10, 100, 1000, 10000, 50, 500, [accounts[1]], {from: accounts[10]});
            let data = await ftso.epochsConfiguration();
            expect(data[0].toNumber()).to.equals(10);
            expect(data[1].toNumber()).to.equals(100);
            expect(data[2].toNumber()).to.equals(1000);
            expect(data[3].toNumber()).to.equals(10000);
            expect(data[4].toNumber()).to.equals(50);
            expect(data[5].toNumber()).to.equals(500);
            expect(data[6]).to.eqls([accounts[1]]);
        });

        it("Should get fasset", async() => {
            let address = await ftso.getFAsset();
            expect(address).to.equals(mockVpToken.address);
        });

        it("Should get initial asset price", async () => {
            let price = await ftso.getCurrentPrice();
            expect(price[0].toNumber()).to.equals(1);
            expect(price[1].toNumber()).to.be.gt(0);
        });

        it("Should not get fasset if fasset is not set", async() => {
            const ftso = await MockFtsoFull.new(
                "WFLR",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );
            let address = await ftso.getFAsset();
            expect(address).to.equals(constants.ZERO_ADDRESS);
        });

        it("Should get current price", async() => {
            let price = await ftso.getCurrentPrice();
            expect(price[0].toNumber()).to.equals(1);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> new current price = 250

            let price2 = await ftso.getCurrentPrice();
            expect(price2[0].toNumber()).to.equals(250);
        });

        it("Should get epoch price", async() => {
            // should revert before initialization
            await expectRevert(ftso.getEpochPrice(epochId), "Epoch data not available");

            await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            let price = await ftso.getEpochPrice(epochId);
            expect(price.toNumber()).to.equals(0);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250

            let price2 = await ftso.getEpochPrice(epochId);
            expect(price2.toNumber()).to.equals(250);
            
            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}); // finalize price -> epochId+1 price = 400

            let price3 = await ftso.getEpochPrice(epochId);
            expect(price3.toNumber()).to.equals(250);
            let price4 = await ftso.getEpochPrice(epochId+1);
            expect(price4.toNumber()).to.equals(400);
        });

        // TODO check that getCurrentRandom is always called after reveal period is over and before new epoch start...
        // it changes in the process of reveals and it is 0 before first reveal
        // getCurrentRandom returns a random of previous epoch or else it can be used to predict which ftso will be chosen
        it("Should get current random", async() => {
            let random = await ftso.getCurrentRandom();
            expect(random.toNumber()).to.equals(0);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let random2 = await ftso.getCurrentRandom();
            expect(random2.toNumber()).to.equals(0);

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            let random3 = await ftso.getCurrentRandom();
            expect(random3.toString()).to.equals(computeVoteRandom([[500, 123]])); // "75282780669876531298563125864469239736494948496730006659928901908576945650647" = keccak256(123, 500)

            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            let random4 = await ftso.getCurrentRandom();
            expect(random4.toString()).to.equals(computeVoteRandom([[500, 123], [250, 124]])); // "63602438260585912703189698405303200700455766745107631159982124671982290245668" = keccak256(123,500) + keccak256(124, 250)

            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            let random5 = await ftso.getCurrentRandom();
            expect(random5.toString()).to.equals(computeVoteRandom([[500, 123], [250, 124], [400, 125]])); // "3548118661429363055776256193746673930982690427070434576280736407613539635493" = keccak256(123,500) + keccak256(124, 250) + keccak256(125, 400)
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250

            let random6 = await ftso.getCurrentRandom();
            expect(random6.toString()).to.equals(random5.toString()); // Computed above
            
            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 223, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 300, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 23, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            let random7 = await ftso.getCurrentRandom();
            expect(random7.toNumber()).to.equals(0); // new epoch with no reveals
            
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 223, {from: accounts[1]});
            let random8 = await ftso.getCurrentRandom();
            expect(random8.toString()).to.equals(computeVoteRandom([[300, 223]])); // "110795213627240982145569590549608355097455138196728857926796593827002785112641" = keccak256(223, 300)

            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 300, {from: accounts[2]});
            let random9 = await ftso.getCurrentRandom();
            expect(random9.toString()).to.equals(computeVoteRandom([[300, 223], [400, 300]])); // "1340778395199417997733493134654933692809673674359391723196464968294144616253" =  keccak256(223, 300) + keccak256(300, 400)

            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 23, {from: accounts[3]});
            let random10 = await ftso.getCurrentRandom();
            expect(random10.toString()).to.equals(computeVoteRandom([[300, 223], [400, 300], [200, 23]]));  // "33056549103278957729624771621298579361541645567473985324007450939133354680375" = keccak256(223, 300) + keccak256(300, 400) + keccak256(23, 200)

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}); // finalize price -> epochId+1 price = 400

            let random11 = await ftso.getCurrentRandom();
            expect(random11.toString()).to.equals(random10.toString()); // computed above

            await increaseTimeTo((epochId + 3) * 120); // reveal period start
            let random12 = await ftso.getCurrentRandom();
            expect(random12.toNumber()).to.equals(0);
        });

        it("Should get current random for epoch 0", async() => {
            const ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();

            await ftso.activateFtso(accounts[4], timestamp.toNumber() + 500, 120, 60, {from: accounts[10]});
            let currentEpoch = await ftso.getCurrentEpochId();
            expect(currentEpoch.toNumber()).to.equals(0);

            let random = await ftso.getCurrentRandom();
            expect(random.toNumber()).to.equals(0);
        });

        it("Should get random for epoch", async() => {
            let random = ftso.getRandom(epochId);
            await expectRevert(random, "Epoch data not available");

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let random2 = await ftso.getRandom(epochId);
            expect(random2.toNumber()).to.equals(0);

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            let random3 = await ftso.getRandom(epochId);
            expect(random3.toString()).to.equals(computeVoteRandom([[500, 123]])); // "75282780669876531298563125864469239736494948496730006659928901908576945650647" = keccak256(123, 500)

            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            let random4 = await ftso.getRandom(epochId);
            expect(random4.toString()).to.equals(computeVoteRandom([[500, 123], [250, 124]])); // "63602438260585912703189698405303200700455766745107631159982124671982290245668" = keccak256(123,500) + keccak256(124, 250)

            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            let random5 = await ftso.getRandom(epochId);
            expect(random5.toString()).to.equals(computeVoteRandom([[500, 123], [250, 124], [400, 125]])); // "3548118661429363055776256193746673930982690427070434576280736407613539635493" = keccak256(123,500) + keccak256(124, 250) + keccak256(125, 400)
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250

            let random6 = await ftso.getRandom(epochId);
            expect(random6.toString()).to.equals(random5.toString()); // Computed above
            
            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 223, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 300, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 23, accounts[3]), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            let random7 = await ftso.getRandom(epochId+1);
            expect(random7.toNumber()).to.equals(0); // new epoch with no reveals
            
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 223, {from: accounts[1]});
            let random8 = await ftso.getRandom(epochId+1);
            expect(random8.toString()).to.equals(computeVoteRandom([[300, 223]])); // "110795213627240982145569590549608355097455138196728857926796593827002785112641" = keccak256(223, 300)

            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 300, {from: accounts[2]});
            let random9 = await ftso.getRandom(epochId+1);
            expect(random9.toString()).to.equals(computeVoteRandom([[300, 223], [400, 300]])); // "1340778395199417997733493134654933692809673674359391723196464968294144616253" =  keccak256(223, 300) + keccak256(300, 400)

            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 23, {from: accounts[3]});
            let random10 = await ftso.getRandom(epochId+1);
            expect(random10.toString()).to.equals(computeVoteRandom([[300, 223], [400, 300], [200, 23]]));  // "33056549103278957729624771621298579361541645567473985324007450939133354680375" = keccak256(223, 300) + keccak256(300, 400) + keccak256(23, 200)

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}); // finalize price -> epochId+1 price = 400

            let random11 = await ftso.getRandom(epochId+1);
            expect(random11.toString()).to.equals(random10.toString()); // computed above

            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 3) * 120); // reveal period start
            let random12 = ftso.getRandom(epochId-1);
            await expectRevert(random12, "Epoch data not available");
            let random13 = await ftso.getRandom(epochId);
            expect(random13.toString()).to.equals(computeVoteRandom([[500, 123], [250, 124], [400, 125]])); // "3548118661429363055776256193746673930982690427070434576280736407613539635493" = keccak256(123,500) + keccak256(124, 250) + keccak256(125, 400)
            let random14 = await ftso.getRandom(epochId+1);
            expect(random14.toString()).to.equals(computeVoteRandom([[300, 223], [400, 300], [200, 23]]));  // "33056549103278957729624771621298579361541645567473985324007450939133354680375" = keccak256(223, 300) + keccak256(300, 400) + keccak256(23, 200)
            let random15 = await ftso.getRandom(epochId+2);
            expect(random15.toNumber()).to.equals(0);
            let random16 = ftso.getRandom(epochId+3);
            await expectRevert(random16, "Epoch data not available");
        });

        it("Should get epoch price for voter", async() => {
            // should revert before initialization
            await expectRevert(ftso.getEpochPriceForVoter(epochId, accounts[1]), "Epoch data not available");

            await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            
            let price = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
            expect(price.toNumber()).to.equals(0);
            let price1 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
            expect(price1.toNumber()).to.equals(0);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            let price2 = ftso.getEpochPriceForVoter(epochId-1, accounts[1]);
            expectRevert(price2, "Epoch data not available");
            let price3 = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
            expect(price3.toNumber()).to.equals(500);
            let price4 = ftso.getEpochPriceForVoter(epochId+1, accounts[1]);
            expectRevert(price4, "Epoch data not available");

            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            let price5 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
            expect(price5.toNumber()).to.equals(250);
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]});
            
            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 223, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 300, accounts[2]), {from: accounts[2]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            let price6 = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
            expect(price6.toNumber()).to.equals(500);
            
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 223, {from: accounts[1]});
            let price7 = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
            expect(price7.toNumber()).to.equals(500);
            let price8 = await ftso.getEpochPriceForVoter(epochId+1, accounts[1]);
            expect(price8.toNumber()).to.equals(300);

            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 300, {from: accounts[2]});
            let price9 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
            expect(price9.toNumber()).to.equals(250);
            let price10 = await ftso.getEpochPriceForVoter(epochId+1, accounts[2]);
            expect(price10.toNumber()).to.equals(400);
        });

        it("Should get current price epoch data", async() => {
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await setMockVotePowerAt(10, 50000, 10000000);
            let data = await ftso.getPriceEpochData();
            expect(data[0].toNumber()).to.equals(epochId);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0);
            expect(data[4]).to.equals(false);

            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            let data1 = await ftso.getPriceEpochData();
            expect(data1[0].toNumber()).to.equals(epochId);
            expect(data1[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data1[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data1[3].toNumber()).to.equals(10); // current price = 1
            expect(data1[4]).to.equals(false);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});

            await increaseTimeTo((epochId + 1) * 120 - 1);
            let data2 = await ftso.getPriceEpochData();
            expect(data2[0].toNumber()).to.equals(epochId);
            expect(data2[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data2[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data2[3].toNumber()).to.equals(10); // current price = 1
            expect(data2[4]).to.equals(false);

            await increaseTimeTo((epochId + 1) * 120);
            let data3 = await ftso.getPriceEpochData();
            expect(data3[0].toNumber()).to.equals(epochId+1);
            expect(data3[1].toNumber()).to.equals((epochId+2) * 120);
            expect(data3[2].toNumber()).to.equals((epochId+2) * 120 + 60);
            expect(data3[3].toNumber()).to.equals(0);
            expect(data3[4]).to.equals(false);

            await setMockVotePowerOfAt(10, 10000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});

            await increaseTimeTo((epochId + 1) * 120 + 60);
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]});

            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            let data4 = await ftso.getPriceEpochData();
            expect(data4[0].toNumber()).to.equals(epochId+1);
            expect(data4[1].toNumber()).to.equals((epochId+2) * 120);
            expect(data4[2].toNumber()).to.equals((epochId+2) * 120 + 60);
            expect(data4[3].toNumber()).to.equals(10); // current price = 500
            expect(data4[4]).to.equals(false);
        });

        it("Should get current price epoch data - fallback mode", async() => {
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await setMockVotePowerAt(10, 50000, 10000000);
            let data = await ftso.getPriceEpochData();
            expect(data[0].toNumber()).to.equals(epochId);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0); // not yet set
            expect(data[4]).to.equals(false);

            await ftso.initializeCurrentEpochStateForReveal(true, {from: accounts[10]});
            let data1 = await ftso.getPriceEpochData();
            expect(data1[0].toNumber()).to.equals(epochId);
            expect(data1[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data1[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data1[3].toNumber()).to.equals(0);
            expect(data1[4]).to.equals(true);
        });

        it("Should get current epoch id", async() => {
            let currentEpochId = await ftso.getCurrentEpochId();
            expect(currentEpochId.toNumber()).to.equals(epochId);

            await increaseTimeTo((epochId + 1) * 120 - 1);
            let currentEpochId2 = await ftso.getCurrentEpochId();
            expect(currentEpochId2.toNumber()).to.equals(epochId);

            await increaseTimeTo((epochId + 1) * 120);
            let currentEpochId3 = await ftso.getCurrentEpochId();
            expect(currentEpochId3.toNumber()).to.equals(epochId+1);
        });

        it("Should get epoch id", async() => {
            let calcEpochId = await ftso.getEpochId(epochId * 120);
            expect(calcEpochId.toNumber()).to.equals(epochId);

            let calcEpochId2 = await ftso.getEpochId((epochId + 1) * 120 - 1);
            expect(calcEpochId2.toNumber()).to.equals(epochId);

            let calcEpochId3 = await ftso.getEpochId((epochId + 1) * 120);
            expect(calcEpochId3.toNumber()).to.equals(epochId+1);

            let calcEpochId4 = await ftso.getEpochId(0);
            expect(calcEpochId4.toNumber()).to.equals(0);
        });

        it("Should get epoch id - no underflow", async() => {
            const ftso1 = await MockFtsoFull.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );
            await ftso1.activateFtso(accounts[4], 500, 120, 60, {from: accounts[10]});

            let currentEpochId = await ftso1.getEpochId(0);
            expect(currentEpochId.toString()).to.equals('0');

            ftso = await MockFtsoFull.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );
            await ftso.activateFtso(accounts[4], (await time.latest()).toNumber() + 500, 120, 60, {from: accounts[10]});

            let currentEpochId1 = await ftso.getCurrentEpochId();
            expect(currentEpochId1.toString()).to.equals('0');

            let currentEpochId2 = await ftso.getEpochId(0);
            expect(currentEpochId2.toString()).to.equals('0');
        });

        it("Should get epoch info", async() => {
            // should revert before initialization
            await expectRevert(ftso.getFullEpochReport(epochId), "Epoch data not available");

            let data;
            // before price submit
            await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            
            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(0);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(0);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(false);
            expect(data[12]).to.equals(false);
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            await increaseTimeTo((epochId + 1) * 120); // reveal period start

            // before price reveal
            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(0);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(0);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(false);
            expect(data[12]).to.equals(false);
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            
            // before price finalization
            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(3);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(0);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(false);
            expect(data[12]).to.equals(false);
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250

            // after price finalization
            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
            expect(data[4].toNumber()).to.equals(250);
            expect(data[5].toNumber()).to.equals(250);
            expect(data[6].toNumber()).to.equals(250);
            expect(data[7].toNumber()).to.equals(3);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(1);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(false);
            expect(data[12]).to.equals(false);
        });

        it("Should get epoch info after finalizing price epoch using trusted addresses votes when epoch has low flr turnout", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[6]), {from: accounts[6]});
            await ftso.submitPriceHash(submitPriceHash(500, 126, accounts[7]), {from: accounts[7]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[6]});
            await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
            await ftso.revealPrice(epochId, 500, 126, {from: accounts[7]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(0);
            expect(data._flrWeights.length).to.equals(0);
            expect(data._flrWeightsSum).to.equals('0');

            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(450), finalizationType: toBN(2)});

            // after price finalization
            let epochData = await ftso.getFullEpochReport(epochId);
            expect(epochData[0].toNumber()).to.equals(epochId * 120);
            expect(epochData[1].toNumber()).to.equals((epochId+1) * 120);
            expect(epochData[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(epochData[3].toNumber()).to.be.gt((epochId+1) * 120 + 60);
            expect(epochData[4].toNumber()).to.equals(450);
            expect(epochData[5].toNumber()).to.equals(0);
            expect(epochData[6].toNumber()).to.equals(0);
            expect(epochData[7].toNumber()).to.equals(4);
            expect(epochData[8].toNumber()).to.equals(10);
            expect(epochData[9].toNumber()).to.equals(2);
            expect(epochData[10].length).to.equals(3);
            expect(epochData[10]).to.eqls([accounts[5], accounts[6], accounts[7]]);
            expect(epochData[11]).to.equals(false);
            expect(epochData[12]).to.equals(false);
        });

        it("Should get epoch info after finalizing price epoch using trusted addresses votes when epoch in fallback mode", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[6]), {from: accounts[6]});
            await ftso.submitPriceHash(submitPriceHash(500, 126, accounts[7]), {from: accounts[7]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(true, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Epoch not initialized for reveal");
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await expectRevert(ftso.revealPrice(epochId, 250, 124, {from: accounts[2]}), "Epoch not initialized for reveal");
            await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[6]});
            await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
            await ftso.revealPrice(epochId, 500, 126, {from: accounts[7]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(0);
            expect(data._flrWeights.length).to.equals(0);
            expect(data._flrWeightsSum).to.equals('0');

            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(450), finalizationType: toBN(2)});

            // after price finalization
            let epochData = await ftso.getFullEpochReport(epochId);
            expect(epochData[0].toNumber()).to.equals(epochId * 120);
            expect(epochData[1].toNumber()).to.equals((epochId+1) * 120);
            expect(epochData[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(epochData[3].toNumber()).to.be.gt((epochId+1) * 120 + 60);
            expect(epochData[4].toNumber()).to.equals(450);
            expect(epochData[5].toNumber()).to.equals(0);
            expect(epochData[6].toNumber()).to.equals(0);
            expect(epochData[7].toNumber()).to.equals(2);
            expect(epochData[8].toNumber()).to.equals(0);
            expect(epochData[9].toNumber()).to.equals(2);
            expect(epochData[10].length).to.equals(3);
            expect(epochData[10]).to.eqls([accounts[5], accounts[6], accounts[7]]);
            expect(epochData[11]).to.equals(false);
            expect(epochData[12]).to.equals(true);

            let votesData = await ftso.getEpochVotes(epochId);
            expect(votesData[0]).to.eqls([accounts[6], accounts[7]]);
            expect(votesData[1]).to.eqls([toBN(400), toBN(500)]);
            expect(votesData[2]).to.eqls([toBN(0), toBN(0)]);
            expect(votesData[3]).to.eqls([toBN(0), toBN(0)]);
            expect(votesData[4]).to.eqls([toBN(0), toBN(0)]);
            expect(votesData[5]).to.eqls([false, false]);
        });

        it("Should get epoch info after finalizing price epoch using trusted addresses votes - using average finalization", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[6]), {from: accounts[6]});
            await ftso.submitPriceHash(submitPriceHash(500, 126, accounts[7]), {from: accounts[7]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 20, 50000, accounts[6]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[6]});
            await setMockVotePowerOfAt(10, 5, 50000, accounts[7]);
            await ftso.revealPrice(epochId, 500, 126, {from: accounts[7]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

            let priceData = await ftso.getCurrentPrice();
            expectEvent(await ftso.averageFinalizePriceEpoch(epochId, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(450), finalizationType: toBN(4)});
            let priceData2 = await ftso.getCurrentPrice();

            // after price finalization
            let epochData = await ftso.getFullEpochReport(epochId);
            expect(epochData[0].toNumber()).to.equals(epochId * 120);
            expect(epochData[1].toNumber()).to.equals((epochId+1) * 120);
            expect(epochData[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(epochData[3].toNumber()).to.be.gt((epochId+1) * 120 + 60);
            expect(epochData[4].toNumber()).to.equals(450);
            expect(epochData[5].toNumber()).to.equals(0);
            expect(epochData[6].toNumber()).to.equals(0);
            expect(epochData[7].toNumber()).to.equals(4);
            expect(epochData[8].toNumber()).to.equals(10);
            expect(epochData[9].toNumber()).to.equals(4);
            expect(epochData[10].length).to.equals(3);
            expect(epochData[10]).to.eqls([accounts[5], accounts[6], accounts[7]]);
            expect(epochData[11]).to.equals(false);
            expect(epochData[12]).to.equals(false);

            expect(priceData2[1].toNumber()).to.be.gt(priceData[1].toNumber());
        });

        it("Should get epoch info after finalizing price epoch using force finalization when epoch has low flr turnout and no votes from trusted addresses", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(0);
            expect(data._flrWeights.length).to.equals(0);
            expect(data._flrWeightsSum).to.equals('0');

            expectEvent(await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(0), finalizationType: toBN(3)});

            // after price finalization
            let epochData = await ftso.getFullEpochReport(epochId);
            expect(epochData[0].toNumber()).to.equals(epochId * 120);
            expect(epochData[1].toNumber()).to.equals((epochId+1) * 120);
            expect(epochData[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(epochData[3].toNumber()).to.be.gt((epochId+1) * 120 + 60);
            expect(epochData[4].toNumber()).to.equals(0);
            expect(epochData[5].toNumber()).to.equals(0);
            expect(epochData[6].toNumber()).to.equals(0);
            expect(epochData[7].toNumber()).to.equals(2);
            expect(epochData[8].toNumber()).to.equals(10);
            expect(epochData[9].toNumber()).to.equals(3);
            expect(epochData[10].length).to.equals(3);
            expect(epochData[10]).to.eqls([accounts[5], accounts[6], accounts[7]]);
            expect(epochData[11]).to.equals(false);
            expect(epochData[12]).to.equals(false);
        });

        it("Should get epoch info after finalizing price epoch using force finalization and no votes from trusted addresses - using average finalization", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 10, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 30, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

            expectEvent(await ftso.averageFinalizePriceEpoch(epochId, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(0), finalizationType: toBN(5)});

            // after price finalization
            let epochData = await ftso.getFullEpochReport(epochId);
            expect(epochData[0].toNumber()).to.equals(epochId * 120);
            expect(epochData[1].toNumber()).to.equals((epochId+1) * 120);
            expect(epochData[2].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(epochData[3].toNumber()).to.be.gt((epochId+1) * 120 + 60);
            expect(epochData[4].toNumber()).to.equals(0);
            expect(epochData[5].toNumber()).to.equals(0);
            expect(epochData[6].toNumber()).to.equals(0);
            expect(epochData[7].toNumber()).to.equals(2);
            expect(epochData[8].toNumber()).to.equals(10);
            expect(epochData[9].toNumber()).to.equals(5);
            expect(epochData[10].length).to.equals(3);
            expect(epochData[10]).to.eqls([accounts[5], accounts[6], accounts[7]]);
            expect(epochData[11]).to.equals(false);
            expect(epochData[12]).to.equals(false);
        });

        it("Should not get epoch info for epoch in future", async() => {
            await expectRevert(ftso.getFullEpochReport(epochId+1), "Epoch data not available");
        });
        
        it("Should get epoch votes", async() => {
            // should revert before initialization
            await expectRevert(ftso.getEpochVotes(epochId), "Epoch data not available");

            let data;
            // before price submit
            await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3].length).to.equals(0);
            expect(data[4].length).to.equals(0);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
            await setMockVotePowerAt(10, 50000, 1000000);
            await increaseTimeTo((epochId + 1) * 120); // reveal period start

            // before price reveal
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3].length).to.equals(0);
            expect(data[4].length).to.equals(0);

            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            
            // before price finalization
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            let prices = [500, 250, 400];
            let weightsFlr = [20000000000, 100000000000, 0];
            
            compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays(data[1], prices);
            compareNumberArrays(data[2], [166666666666, 783333333333, 50000000000]);
            compareNumberArrays(data[3], weightsFlr);
            compareNumberArrays(data[4], [100000000, 0, 500000000]);
            compareArrays<boolean>(data[5], [false, false, false]);
            
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250
            
            // after price finalization
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);
            
            let id1 = data[0].indexOf(accounts[1]);
            let id2 = data[0].indexOf(accounts[2]);
            let id3 = data[0].indexOf(accounts[3]);
            
            compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices);
            compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [166666666666, 783333333333, 50000000000]);
            compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], weightsFlr);
            compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [100000000, 0, 500000000]);
            compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, false]);

            await ftso.submitPriceHash(submitPriceHash(300, 223, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(400, 300, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(200, 23, accounts[3]), {from: accounts[3]});
            await ftso.setVotePowerBlock(12, { from: accounts[10] });
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 223, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 300, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 23, {from: accounts[3]});
            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end

            // before price finalization 2
            data = await ftso.getEpochVotes(epochId+1);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            let prices2 = [300, 400, 200];
            let flrWeights = [100000000000, 100000000000, 100000000000];
            let assetWeights = [0, 800000000000, 100000000000];

            compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays(data[1], prices2);
            compareNumberArrays(data[2], [166666666666, 611111111110, 222222222221]);
            compareNumberArrays(data[3], flrWeights);
            compareNumberArrays(data[4], assetWeights);
            compareArrays<boolean>(data[5], [false, false, false]);

            await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}); // finalize price -> epochId+1 price = 400

            // after price finalization 2
            data = await ftso.getEpochVotes(epochId+1);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            id1 = data[0].indexOf(accounts[1]);
            id2 = data[0].indexOf(accounts[2]);
            id3 = data[0].indexOf(accounts[3]);

            compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices2);
            compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [166666666666, 611111111110, 222222222221]);
            compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], flrWeights);
            compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], assetWeights);
            compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [true, true, false]);
        });

        it("Should not get epoch votes for epoch in future", async() => {
            await expectRevert(ftso.getEpochVotes(epochId+1), "Epoch data not available");
        });
    });

    describe("getters (without fAsset)", async () => {
        beforeEach(async () => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                1, // initial token price 0.00001$
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[6]], { from: accounts[10] });
            await ftso.setVotePowerBlock(10, { from: accounts[10] });
            await ftso.activateFtso(accounts[4], 0, 120, 60, { from: accounts[10] });

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        // fixed
        it("Should get null fasset", async () => {
            let address = await ftso.getFAsset();
            expect(address).to.equals(constants.ZERO_ADDRESS);
        });

        it("Should get current price", async () => {
            let price = await ftso.getCurrentPrice();
            expect(price[0].toNumber()).to.equals(1);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            await ftso.setVotePowerBlock(12, { from: accounts[10] });

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 100, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 500, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> new current price = 250

            let price2 = await ftso.getCurrentPrice();
            expect(price2[0].toNumber()).to.equals(250);
            expect(price2[1].toNumber()).to.be.gt(price[1].toNumber());
        });

        it("Should get epoch price", async () => {
            // should revert before initialization
            await expectRevert(ftso.getEpochPrice(epochId), "Epoch data not available");

            await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            let price = await ftso.getEpochPrice(epochId);
            expect(price.toNumber()).to.equals(0);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });

            await ftso.setVotePowerBlock(12, { from: accounts[10] });

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> epochId price = 250

            let price2 = await ftso.getEpochPrice(epochId);
            expect(price2.toNumber()).to.equals(250);

            // round 2 - current fasset price = 250
            await ftso.submitPriceHash(submitPriceHash(300, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(400, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(200, 125, accounts[3]), { from: accounts[3] });

            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId + 1, 300, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId + 1, 400, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId + 1, 200, 125, { from: accounts[3] });

            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }); // finalize price -> epochId+1 price = 300 (fAsset ignored)

            let price3 = await ftso.getEpochPrice(epochId);
            expect(price3.toNumber()).to.equals(250);
            let price4 = await ftso.getEpochPrice(epochId + 1);
            expect(price4.toNumber()).to.equals(300);
        });
        
        it("Should get epoch info", async () => {
            // should revert before initialization
            await expectRevert(ftso.getFullEpochReport(epochId), "Epoch data not available");
            
            let data;
            // before price submit
            await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId + 1) * 120);
            expect(data[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(0);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(0);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(false);
            expect(data[12]).to.equals(false);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });
            await increaseTimeTo((epochId + 1) * 120); // reveal period start

            // before price reveal
            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId + 1) * 120);
            expect(data[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(0);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(0);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(false);
            expect(data[12]).to.equals(false);

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 1, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end

            // before price finalization
            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId + 1) * 120);
            expect(data[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
            expect(data[3].toNumber()).to.equals(0);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(3);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(0);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(false);
            expect(data[12]).to.equals(false);

            await ftso.finalizePriceEpoch(epochId, true, { from: accounts[10] }); // finalize price -> epochId price = 250

            // after price finalization
            data = await ftso.getFullEpochReport(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId + 1) * 120);
            expect(data[2].toNumber()).to.equals((epochId + 1) * 120 + 60);
            expect(data[3].toNumber()).to.be.gt((epochId + 1) * 120 + 60);
            expect(data[4].toNumber()).to.equals(250);
            expect(data[5].toNumber()).to.equals(250);
            expect(data[6].toNumber()).to.equals(250);
            expect(data[7].toNumber()).to.equals(3);
            expect(data[8].toNumber()).to.equals(10);
            expect(data[9].toNumber()).to.equals(1);
            expect(data[10].length).to.equals(0);
            expect(data[11]).to.equals(true);
            expect(data[12]).to.equals(false);
        });

        it("Should get epoch votes", async () => {
            // should revert before initialization
            await expectRevert(ftso.getEpochVotes(epochId), "Epoch data not available");

            let data;
            // before price submit
            await increaseTimeTo(epochId * 120 + 30); // initialize price epoch
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });

            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3].length).to.equals(0);
            expect(data[4].length).to.equals(0);

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), { from: accounts[3] });
            await increaseTimeTo((epochId + 1) * 120); // reveal period start

            // before price reveal
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3].length).to.equals(0);
            expect(data[4].length).to.equals(0);

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] });
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, { from: accounts[2] });
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, { from: accounts[3] });
            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            // Everyone voted
            // before price finalization
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            let prices = [500, 250, 400];
            let weightsFlr = [20000000000, 100000000000, 0];

            compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays(data[1], prices);
            compareNumberArrays(data[2], [166666666666, 833333333333, 0]);
            compareNumberArrays(data[3], weightsFlr);
            compareNumberArrays(data[4], [0, 0, 0]); // always 0 after first price finalization, as current price was 0
            compareArrays<boolean>(data[5], [false, false, false]);

            await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }); // finalize price -> epochId price = 250

            // after price finalization
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            let id1 = data[0].indexOf(accounts[1]);
            let id2 = data[0].indexOf(accounts[2]);
            let id3 = data[0].indexOf(accounts[3]);

            compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices);
            compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [166666666666, 833333333333, 0]);
            compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], weightsFlr);
            compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [0, 0, 0]); // always 0 after first price finalization, as current price was 0
            compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, false]);

            await ftso.submitPriceHash(submitPriceHash(300, 223, accounts[1]), { from: accounts[1] });
            await ftso.submitPriceHash(submitPriceHash(400, 300, accounts[2]), { from: accounts[2] });
            await ftso.submitPriceHash(submitPriceHash(200, 23, accounts[3]), { from: accounts[3] });
            await ftso.setVotePowerBlock(12, { from: accounts[10] });
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            await increaseTimeTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId + 1, 300, 223, { from: accounts[1] });
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId + 1, 400, 300, { from: accounts[2] });
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId + 1, 200, 23, { from: accounts[3] });
            await increaseTimeTo((epochId + 2) * 120 + 60); // reveal period end

            // before price finalization 2
            data = await ftso.getEpochVotes(epochId + 1);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            let prices2 = [300, 400, 200];
            let flrWeights = [100000000000, 100000000000, 100000000000];
            let assetWeights = [0, 0, 0];

            compareArrays<string>(data[0], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays(data[1], prices2);
            compareNumberArrays(data[2], [333333333333, 333333333333, 333333333333]);
            compareNumberArrays(data[3], flrWeights);
            compareNumberArrays(data[4], assetWeights);
            compareArrays<boolean>(data[5], [false, false, false]);

            await ftso.finalizePriceEpoch(epochId + 1, false, { from: accounts[10] }); // finalize price -> epochId+1 price = 400

            // after price finalization 2
            data = await ftso.getEpochVotes(epochId + 1);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            id1 = data[0].indexOf(accounts[1]);
            id2 = data[0].indexOf(accounts[2]);
            id3 = data[0].indexOf(accounts[3]);

            // asset weighted votes should be ignored
            compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], prices2);
            compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [333333333333, 333333333333, 333333333333]);
            compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], flrWeights);
            compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], assetWeights);
            compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [true, true, true]);
        });
    });

    describe("multi fasset ftsos", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new(accounts[0], "A token", "ATOK");
            mockFtsos = [];
            mockFtsos[0] = await MockFtso.new();
            mockFtsos[1] = await MockFtso.new();
            mockFtsos[2] = await MockFtso.new();
            mockVpTokens = [];
            mockVpTokens[0] = await MockVpToken.new();
            mockVpTokens[1] = await MockVpToken.new();
            mockVpTokens[2] = await MockVpToken.new();
            supplyInterface = await Supply.new(accounts[0], constants.ZERO_ADDRESS, accounts[0], 1000, 0, []);
            mockSupply = await MockSupply.new();
            ftso = await MockFtsoFull.new(
                "WFLR",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                0, 0, 0, // Force init as normal FTSO with access to submit_hash
                0,
                1e10,
                defaultPriceEpochCyclicBufferSize
            );

            const fasset_vpToken = ftso.contract.methods.getFAsset().encodeABI();
            const fasset0Return_vpToken = web3.eth.abi.encodeParameter('address', mockVpTokens[0].address);
            await mockFtsos[0].givenMethodReturn(fasset_vpToken, fasset0Return_vpToken);
            const fasset1Return_vpToken = web3.eth.abi.encodeParameter('address', mockVpTokens[1].address);
            await mockFtsos[1].givenMethodReturn(fasset_vpToken, fasset1Return_vpToken);
            const fasset2Return_vpToken = web3.eth.abi.encodeParameter('address', mockVpTokens[2].address);
            await mockFtsos[2].givenMethodReturn(fasset_vpToken, fasset2Return_vpToken);

            const decimals_vpToken = vpTokenInterface.contract.methods.decimals().encodeABI();
            const decimals3Return_vpToken = web3.eth.abi.encodeParameter('uint256', 3);
            await mockVpTokens[0].givenMethodReturn(decimals_vpToken, decimals3Return_vpToken);
            const decimals1Return_vpToken = web3.eth.abi.encodeParameter('uint256', 1);
            await mockVpTokens[1].givenMethodReturn(decimals_vpToken, decimals1Return_vpToken); 

            await ftso.setFAssetFtsos([mockFtsos[0].address, mockFtsos[1].address, mockFtsos[2].address], {from: accounts[10]});
            await ftso.configureEpochs(1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp.toNumber() / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should finalize price epoch with correct vote powers", async() => {
            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});

            await setMockVotePowerAtMultiple(10, 50000, [5000000, 200000, 7500], [1000, 3, 800]);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAtMultiple(10, 1000, [1000000, 150000, 0], accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAtMultiple(10, 5000, [0, 5000, 1000], accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAtMultiple(10, 0, [500000, 0, 6000], accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(400), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(400), finalizationType: toBN(1)});

            // after price finalization
            let data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            let id1 = data[0].indexOf(accounts[1]);
            let id2 = data[0].indexOf(accounts[2]);
            let id3 = data[0].indexOf(accounts[3]);

            compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], [500, 250, 400]);
            compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [144189142620, 475057955734, 380752901644]);
            compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], [20000000000, 100000000000, 0]);
            compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [82006377077, 78685307539, 513084393928]);
            compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, true]);
        });

        it("Should finalize price epoch with correct vote powers - with ftso without fasset", async() => {
            let mockFtsoWithoutFasset = await MockFtso.new();
            await ftso.setFAssetFtsos([mockFtsoWithoutFasset.address, mockFtsos[0].address, mockFtsos[1].address, mockFtsos[2].address], {from: accounts[10]});

            await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), {from: accounts[1]});
            await ftso.submitPriceHash(submitPriceHash(250, 124, accounts[2]), {from: accounts[2]});
            await ftso.submitPriceHash(submitPriceHash(400, 125, accounts[3]), {from: accounts[3]});
        
            const currentPrice_ftso = ftso.contract.methods.getCurrentPrice().encodeABI();
            const currentPriceReturn_ftso = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [500, 1]);
            await mockFtsoWithoutFasset.givenMethodReturn(currentPrice_ftso, currentPriceReturn_ftso);

            await setMockVotePowerAtMultiple(10, 50000, [5000000, 200000, 7500], [1000, 3, 800]);
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAtMultiple(10, 1000, [1000000, 150000, 0], accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAtMultiple(10, 5000, [0, 5000, 1000], accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAtMultiple(10, 0, [500000, 0, 6000], accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await increaseTimeTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized",
                {epochId: toBN(epochId), price: toBN(400), rewardedFtso: false, lowRewardPrice: toBN(250), highRewardPrice: toBN(400), finalizationType: toBN(1)});

            // after price finalization
            let data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(3);
            expect(data[1].length).to.equals(3);
            expect(data[2].length).to.equals(3);
            expect(data[3].length).to.equals(3);
            expect(data[4].length).to.equals(3);

            let id1 = data[0].indexOf(accounts[1]);
            let id2 = data[0].indexOf(accounts[2]);
            let id3 = data[0].indexOf(accounts[3]);

            compareArrays<string>([data[0][id1], data[0][id2], data[0][id3]], [accounts[1], accounts[2], accounts[3]]);
            compareNumberArrays([data[1][id1], data[1][id2], data[1][id3]], [500, 250, 400]);
            compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [144189142620, 475057955734, 380752901644]);
            compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], [20000000000, 100000000000, 0]);
            compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [82006377077, 78685307539, 513084393928]);
            compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, true]);
        });

        it("Should not get fasset if multi fasset ftsos", async() => {
            let address = await ftso.getFAsset();
            expect(address).to.equals(constants.ZERO_ADDRESS);
        });

        it("Should update fassets", async() => {
            await ftso.setFAssetFtsos([mockFtsos[2].address, mockFtsos[0].address], {from: accounts[10]});
            expect(await ftso.fAssetFtsos(0)).to.equals(mockFtsos[2].address);
            expect(await ftso.fAssetFtsos(1)).to.equals(mockFtsos[0].address);
            await expectRevert.unspecified(ftso.fAssetFtsos(2));
            expect(await ftso.fAssets(0)).to.equals(mockVpTokens[2].address);
            expect(await ftso.fAssets(1)).to.equals(mockVpTokens[0].address);
            await expectRevert.unspecified(ftso.fAssets(2));
        });

        it("Should not set fassets if not ftso manager", async() => {
            await expectRevert(ftso.setFAssetFtsos([mockFtsos[0].address, mockFtsos[1].address], {from: accounts[1]}), "Access denied");
        });
    });
});
