import { FtsoContract, FtsoInstance, MockContractContract, MockContractInstance, VPTokenContract, VPTokenInstance, WFLRContract, WFLRInstance } from "../../../typechain-truffle";
import { compareArrays, compareNumberArrays, toBN } from "../../utils/test-helpers";
const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;
const { soliditySha3 } = require("web3-utils");

const Wflr = artifacts.require("WFLR") as WFLRContract;
const MockWflr = artifacts.require("MockContract") as MockContractContract;
const VpToken = artifacts.require("VPToken") as VPTokenContract;
const MockVpToken = artifacts.require("MockContract") as MockContractContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const MockFtso = artifacts.require("MockContract") as MockContractContract;

// contains a fresh contract for each test 
let wflrInterface: WFLRInstance;
let mockWflr: MockContractInstance;
let vpTokenInterface: VPTokenInstance;
let mockVpToken: MockContractInstance;
let ftso: FtsoInstance;
let epochId: number;

// multi faseet ftsos
let mockFtsos: MockContractInstance[];
let mockVpTokens: MockContractInstance[];

async function setMockVotePowerAt(blockNumber: number, wflrVotePower: number, fassetVotePower: number) {
    const votePowerAt_wflr = wflrInterface.contract.methods.votePowerAt(blockNumber).encodeABI();
    const votePowerAtReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenMethodReturn(votePowerAt_wflr, votePowerAtReturn_wflr);
    const votePowerAt_vpToken = vpTokenInterface.contract.methods.votePowerAt(blockNumber).encodeABI();
    const votePowerAtReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePower);
    await mockVpToken.givenMethodReturn(votePowerAt_vpToken, votePowerAtReturn_vpToken);
}

async function setMockVotePowerOfAt(blockNumber: number, wflrVotePower: number, fassetVotePower: number, address: string) {
    const votePowerOfAt_wflr = wflrInterface.contract.methods.votePowerOfAt(address, blockNumber).encodeABI();
    const votePowerOfAtReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenMethodReturn(votePowerOfAt_wflr, votePowerOfAtReturn_wflr);
    const votePowerOfAt_vpToken = vpTokenInterface.contract.methods.votePowerOfAt(address, blockNumber).encodeABI();
    const votePowerOfAtReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePower);
    await mockVpToken.givenMethodReturn(votePowerOfAt_vpToken, votePowerOfAtReturn_vpToken);
}

async function setMockVotePowerAtMultiple(blockNumber: number, wflrVotePower: number, fassetVotePowers: number[], currentPrices: number[]) {
    const len = fassetVotePowers.length;
    assert(len == mockFtsos.length, "Fasset vote powers length does not match mock Ftso contracts length");
    assert(len == mockVpTokens.length, "Fasset vote powers length does not match mock VPToken contracts length");
    assert(len == currentPrices.length, "Fasset vote powers length does not match current prices length");
    const votePowerAt_wflr = wflrInterface.contract.methods.votePowerAt(blockNumber).encodeABI();
    const votePowerAtReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenMethodReturn(votePowerAt_wflr, votePowerAtReturn_wflr);
    for (let i = 0; i < len; i++) {
        const votePowerAt_vpToken = vpTokenInterface.contract.methods.votePowerAt(blockNumber).encodeABI();
        const votePowerAtReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePowers[i]);
        await mockVpTokens[i].givenMethodReturn(votePowerAt_vpToken, votePowerAtReturn_vpToken);

        const fasset_ftso = ftso.contract.methods.getFAsset().encodeABI();
        const fassetReturn_ftso = web3.eth.abi.encodeParameter('address', mockVpTokens[i].address);
        await mockFtsos[i].givenMethodReturn(fasset_ftso, fassetReturn_ftso);

        const currentPrice_ftso = ftso.contract.methods.getCurrentPrice().encodeABI();
        const currentPriceReturn_ftso = web3.eth.abi.encodeParameter('uint256', currentPrices[i]);
        await mockFtsos[i].givenMethodReturn(currentPrice_ftso, currentPriceReturn_ftso);
    }
}

async function setMockVotePowerOfAtMultiple(blockNumber: number, wflrVotePower: number, fassetVotePowers: number[], address: string) {
    const len = fassetVotePowers.length;
    assert(len == mockVpTokens.length, "Fasset vote powers length does not match mock VPToken contracts length");
    const votePowerOfAt_wflr = wflrInterface.contract.methods.votePowerOfAt(address, blockNumber).encodeABI();
    const votePowerOfAtReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenMethodReturn(votePowerOfAt_wflr, votePowerOfAtReturn_wflr);
    for (let i = 0; i < len; i++) {
        const votePowerOfAt_vpToken = vpTokenInterface.contract.methods.votePowerOfAt(address, blockNumber).encodeABI();
        const votePowerOfAtReturn_vpToken = web3.eth.abi.encodeParameter('uint256', fassetVotePowers[i]);
        await mockVpTokens[i].givenMethodReturn(votePowerOfAt_vpToken, votePowerOfAtReturn_vpToken);
    }
}

contract(`Ftso.sol; ${getTestFile(__filename)}; Ftso unit tests`, async accounts => {

    describe("initialize and configure", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new();
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new("A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            ftso = await Ftso.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10]
            );
        });

        it("Should activate ftso", async() => {
            await ftso.initializeEpochs(0, 120, 60, {from: accounts[10]});
            let hash = soliditySha3(500, 123);
            expectEvent(await ftso.submitPrice(hash, {from: accounts[1]}), "PriceSubmitted");
        });

        it("Should not activate ftso if not ftso manager", async() => {
            await expectRevert(ftso.initializeEpochs(0, 120, 60, {from: accounts[1]}), "Access denied");
            let hash = soliditySha3(500, 123);
            await expectRevert(ftso.submitPrice(hash, {from: accounts[1]}), "FTSO not active");
        });

        it("Should not activate ftso if already activated", async() => {
            await ftso.initializeEpochs(0, 120, 60, {from: accounts[10]});
            await expectRevert(ftso.initializeEpochs(0, 120, 60, {from: accounts[10]}), "FTSO already activated");
            await expectRevert(ftso.initializeEpochs(0, 120, 60, {from: accounts[1]}), "Access denied");
        });

        it("Should revert at submit price if not activated", async() => {
            let hash = soliditySha3(500, 123);
            await expectRevert(ftso.submitPrice(hash, {from: accounts[1]}), "FTSO not active");
        });

        it("Should revert at reveal price if not activated", async() => {
            await expectRevert(ftso.revealPrice(1, 500, 123, {from: accounts[1]}), "FTSO not active");
        });

        it("Should configure epochs", async() => {
            await ftso.configureEpochs(0, 100, 200, 20, 30, 400, 800, 500, {from: accounts[10]});
        });

        it("Should not configure epochs ftso if not ftso manager", async() => {
            await expectRevert(ftso.configureEpochs(0, 200, 200, 20, 20, 200, 800, 500, {from: accounts[1]}), "Access denied");
        });

        it("Should set vote power block", async() => {
            await ftso.setVotePowerBlock(20, {from: accounts[10]});
        });

        it("Should not set vote power block if not ftso manager", async() => {
            await expectRevert(ftso.setVotePowerBlock(20, {from: accounts[1]}), "Access denied");
        });

        it("Should set fassets", async() => {
            ftso = await Ftso.new(
                mockWflr.address,
                constants.ZERO_ADDRESS,
                accounts[10]
            );
            await ftso.setFAssetFtsos([accounts[1], accounts[2]], {from: accounts[10]});
        });

        it("Should not set fassets when single asset ftso", async() => {
            await expectRevert(ftso.setFAssetFtsos([accounts[1], accounts[2]], {from: accounts[10]}), "Single asset FTSO");
        });

        it("Should not set fassets if not ftso manager", async() => {
            await expectRevert(ftso.setFAssetFtsos([accounts[1], accounts[2]], {from: accounts[1]}), "Access denied");
        });
    });

    describe("submit and reveal price", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new();
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new("A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            ftso = await Ftso.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10]
            );

            await ftso.configureEpochs(0, 1e10, 1e10, 1, 1, 1000, 10000, 50, {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.initializeEpochs(0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp / 120) + 1;
            await time.increaseTo(epochId * 120);
        });

        it("Should submit price", async() => {
            let hash = soliditySha3(500, 123);
            expectEvent(await ftso.submitPrice(hash, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});
        });

        it("Should submit price multiple times", async() => {
            let hash1 = soliditySha3(500, 123);
            expectEvent(await ftso.submitPrice(hash1, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});

            let hash2 = soliditySha3(500, 124);
            expectEvent(await ftso.submitPrice(hash2, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});

            let hash3 = soliditySha3(500, 125);
            expectEvent(await ftso.submitPrice(hash3, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});
        });

        it("Should submit price multiple times - different users", async() => {
            let hash1 = soliditySha3(500, 123);
            expectEvent(await ftso.submitPrice(hash1, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});

            let hash2 = soliditySha3(250, 124);
            expectEvent(await ftso.submitPrice(hash2, {from: accounts[2]}), "PriceSubmitted", {submitter: accounts[2], epochId: toBN(epochId)});

            let hash3 = soliditySha3(400, 125);
            expectEvent(await ftso.submitPrice(hash3, {from: accounts[3]}), "PriceSubmitted", {submitter: accounts[3], epochId: toBN(epochId)});
        });

        it("Should initialize epoch state for reveal", async() => {
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
        });

        it("Should not initialize epoch state for reveal if not ftso manager", async() => {
            await expectRevert(ftso.initializeCurrentEpochStateForReveal({from: accounts[1]}), "Access denied");
        });

        it("Should reveal price", async() => {
            let hash = soliditySha3(500, 123);
            expectEvent(await ftso.submitPrice(hash, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            expectEvent(await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500)});
        });

        it("Should reveal price - different users", async() => {
            let hash1 = soliditySha3(500, 123);
            expectEvent(await ftso.submitPrice(hash1, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});
            let hash2 = soliditySha3(250, 124);
            expectEvent(await ftso.submitPrice(hash2, {from: accounts[2]}), "PriceSubmitted", {submitter: accounts[2], epochId: toBN(epochId)});
            let hash3 = soliditySha3(400, 125);
            expectEvent(await ftso.submitPrice(hash3, {from: accounts[3]}), "PriceSubmitted", {submitter: accounts[3], epochId: toBN(epochId)});
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            expectEvent(await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500)});
            expectEvent(await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]}), "PriceRevealed", {voter: accounts[2], epochId: toBN(epochId), price: toBN(250)});
            expectEvent(await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]}), "PriceRevealed", {voter: accounts[3], epochId: toBN(epochId), price: toBN(400)});
        });

        it("Should reveal price for last submitted hash only", async() => {
            let hash1 = soliditySha3(500, 123);
            expectEvent(await ftso.submitPrice(hash1, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});
            let hash2 = soliditySha3(500, 124);
            expectEvent(await ftso.submitPrice(hash2, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});
            let hash3 = soliditySha3(500, 125);
            expectEvent(await ftso.submitPrice(hash3, {from: accounts[1]}), "PriceSubmitted", {submitter: accounts[1], epochId: toBN(epochId)});
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price already revealed or not valid");
            await expectRevert(ftso.revealPrice(epochId, 500, 124, {from: accounts[1]}), "Price already revealed or not valid");
            expectEvent(await ftso.revealPrice(epochId, 500, 125, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500)});
        });

        it("Should not reveal price before submit period is over", async() => {
            let hash = soliditySha3(500, 123);
            await ftso.submitPrice(hash, {from: accounts[1]});
            await time.increaseTo((epochId + 1) * 120 - 1);
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price reveal for epoch not possible");
        });

        it("Should not reveal price after reveal period is over", async() => {
            let hash = soliditySha3(500, 123);
            await ftso.submitPrice(hash, {from: accounts[1]});
            await time.increaseTo((epochId + 1) * 120 + 60);
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price reveal for epoch not possible");
        });

        it("Should not reveal price twice", async() => {
            let hash = soliditySha3(500, 123);
            await ftso.submitPrice(hash, {from: accounts[1]});
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            expectEvent(await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "PriceRevealed", {voter: accounts[1], epochId: toBN(epochId), price: toBN(500)});
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price already revealed or not valid");
        });

        it("Should not reveal price if epoch is not initialized", async() => {
            let hash = soliditySha3(500, 123);
            await ftso.submitPrice(hash, {from: accounts[1]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Epoch not initialized for reveal");
        });

        it("Should not reveal price if submit price was not called", async() => {
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, 500, 123, {from: accounts[1]}), "Price already revealed or not valid");
        });

        it("Should not reveal price if hash and price+random do not match", async() => {
            let hash = soliditySha3(500, 123);
            await ftso.submitPrice(hash, {from: accounts[1]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, 500, 125, {from: accounts[1]}), "Price already revealed or not valid");
        });

        it("Should not reveal price if price is too high", async() => {
            let price = toBN(2).pow(toBN(128));
            let hash = soliditySha3(price, 123);
            await ftso.submitPrice(hash, {from: accounts[1]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.revealPrice(epochId, price, 123, {from: accounts[1]}), "Price too high");
        });

        it("Should not reveal price if vote power is insufficient", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(250), forced: false});

            // round 2 - current fasset price = 250
            await ftso.configureEpochs(0, 10, 100, 1, 1, 1000, 10000, 50, {from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});

            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});

            await setMockVotePowerAt(12, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 5000-1, 0, accounts[1]);
            await expectRevert(ftso.revealPrice(epochId+1, 500, 123, {from: accounts[1]}), "Insufficient vote power to submit vote");
            await setMockVotePowerOfAt(12, 5000-1, 10000-1, accounts[2]);
            await expectRevert(ftso.revealPrice(epochId+1, 250, 124, {from: accounts[2]}), "Insufficient vote power to submit vote");
            await setMockVotePowerOfAt(12, 0, 10000-1, accounts[3]);
            await expectRevert(ftso.revealPrice(epochId+1, 400, 125, {from: accounts[3]}), "Insufficient vote power to submit vote");

            // ok if enough vote power
            await setMockVotePowerOfAt(12, 5000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 5000, 10000, accounts[2]);
            await ftso.revealPrice(epochId+1, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 0, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 400, 125, {from: accounts[3]});
        });
    });

    describe("finalize price", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new();
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new("A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            ftso = await Ftso.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10]
            );

            await ftso.configureEpochs(0, 1e10, 1e10, 1, 1, 1000, 10000, 50, {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.initializeEpochs(0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp / 120) + 1;
            await time.increaseTo(epochId * 120);
        });

        // TODO should not finalize more than once?
        it("Should finalize price epoch - no votes", async() => {
            expectEvent(await ftso.finalizePriceEpoch(0, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(0), price: toBN(0), forced: true});
            expectEvent(await ftso.finalizePriceEpoch(0, true, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(0), price: toBN(0), forced: true});
            expectEvent(await ftso.finalizePriceEpoch(1, true, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(1), price: toBN(0), forced: true});
        });

        it("Should finalize price epoch", async() => {
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(250), forced: false});
        });

        it("Should finalize price epoch - closestPriceFix test", async() => {
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});

            await setMockVotePowerAt(10, 3000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 0, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});

            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(500), forced: false});
        });

        it("Should finalize price epoch - two epochs", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(250), forced: false});

            // round 2 - current fasset price = 250
            await ftso.submitPrice(soliditySha3(300, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(400, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(200, 125), {from: accounts[3]});

            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId+1), price: toBN(300), forced: false});
        });

        it("Should finalize price epoch - two epochs with different vote power blocks", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(250), forced: false});
            
            // round 2 - current fasset price = 250
            await ftso.submitPrice(soliditySha3(300, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(400, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(200, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            
            await time.increaseTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId+1), price: toBN(400), forced: false});
        });

        it("Should finalize price epoch - two epochs - no votes in second one", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(250), forced: false});
            
            // round 2 - current fasset price = 250
            await time.increaseTo((epochId + 2) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId+1), price: toBN(250), forced: true});
        });

        it("Should finalize price epoch and return rewarded addresses", async() => {
            // round 1 - current fasset price = 0
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await time.increaseTo((epochId + 1) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)

            let data = await ftso.contract.methods.finalizePriceEpoch(epochId, true).call({from: accounts[10]});
            expect(data._eligibleAddresses.length).to.equals(1);
            expect(data._eligibleAddresses[0]).to.equals(accounts[2]);
            expect(data._flrWeights.length).to.equals(1);
            expect(data._flrWeights[0]).to.equals('100000000000');
            expect(data._flrWeightsSum).to.equals('100000000000');
            await ftso.finalizePriceEpoch(epochId, true, {from: accounts[10]});
            
            // round 2 - current fasset price = 250
            await time.increaseTo((epochId + 2) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
            let data2 = await ftso.contract.methods.finalizePriceEpoch(epochId+1, true).call({from: accounts[10]});
            expect(data2._eligibleAddresses.length).to.equals(0);
            expect(data2._flrWeights.length).to.equals(0);
            expect(data2._flrWeightsSum).to.equals('0');
            await ftso.finalizePriceEpoch(epochId+1, true, {from: accounts[10]});

            // round 3 - current fasset price = 250
            await ftso.submitPrice(soliditySha3(300, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(400, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(200, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            
            await time.increaseTo((epochId + 3) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 4000, 0, accounts[1]);
            await ftso.revealPrice(epochId+2, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 3000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+2, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+2, 200, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 3) * 120 + 60 + 1); // reveal period end (+1 as call does not increase time)
            let data3 = await ftso.contract.methods.finalizePriceEpoch(epochId+2, true).call({from: accounts[10]});
            expect(data3._eligibleAddresses.length).to.equals(2);
            let id1 = data3._eligibleAddresses.indexOf(accounts[1]);
            let id2 = data3._eligibleAddresses.indexOf(accounts[2]);
            expect(data3._eligibleAddresses[id1]).to.equals(accounts[1]);
            expect(data3._eligibleAddresses[id2]).to.equals(accounts[2]);
            expect(data3._flrWeights.length).to.equals(2);
            expect(data3._flrWeights[id1]).to.equals('200000000000');
            expect(data3._flrWeights[id2]).to.equals('150000000000');
            expect(data3._flrWeightsSum).to.equals('350000000000');
            await ftso.finalizePriceEpoch(epochId+2, true, {from: accounts[10]});
        });

        it("Should not finalize price epoch if not ftso manager", async() => {
            await expectRevert(ftso.finalizePriceEpoch(0, true, {from: accounts[1]}), "Access denied");
        });

        it("Should not finalize price epoch if epoch has insufficient number of votes", async() => {
            await ftso.configureEpochs(1, 1e10, 1e10, 1, 1, 1000, 10000, 50, {from: accounts[10]});
            await expectRevert(ftso.finalizePriceEpoch(epochId-2, false, {from: accounts[10]}), "Epoch has insufficient number of votes");
        });

        it("Should force finalize price epoch if epoch has insufficient number of votes", async() => {
            await ftso.configureEpochs(1, 1e10, 1e10, 1, 1, 1000, 10000, 50, {from: accounts[10]});
            await expectRevert(ftso.finalizePriceEpoch(epochId-2, false, {from: accounts[10]}), "Epoch has insufficient number of votes");
            expectEvent(await ftso.forceFinalizePriceEpoch(epochId-2, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId-2), price: toBN(0), forced: true});
        });

        it("Should not finalize price epoch for epoch in submit price period", async() => {
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
            await time.increaseTo((epochId + 1) * 120 - 1); // submit period end -1s
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
        });

        it("Should not finalize price epoch for epoch in reveal price period", async() => {
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
            await time.increaseTo((epochId + 1) * 120 + 60 - 1); // reveal period end -1s
            await expectRevert(ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "Epoch not ready for finalization");
        });

        it("Should not finalize price epoch for epoch in future", async() => {
            await expectRevert(ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}), "Epoch not ready for finalization");
        });

        it("Should force finalize price epoch", async() => {
            expectEvent(await ftso.forceFinalizePriceEpoch(0, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(0), price: toBN(0), forced: true});
            expectEvent(await ftso.forceFinalizePriceEpoch(0, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(0), price: toBN(0), forced: true});
            expectEvent(await ftso.forceFinalizePriceEpoch(1, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(1), price: toBN(0), forced: true});
        });

        it("Should not force finalize price epoch if not ftso manager", async() => {
            await expectRevert(ftso.forceFinalizePriceEpoch(0, {from: accounts[1]}), "Access denied");
        });
    });

    describe("getters", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new();
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new("A token", "ATOK");
            mockVpToken = await MockVpToken.new();
            ftso = await Ftso.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10]
            );

            await ftso.configureEpochs(0, 1e10, 1e10, 1, 1, 1000, 10000, 50, {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.initializeEpochs(0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp / 120) + 1;
            await time.increaseTo(epochId * 120);
        });

        it("Should get epochs configuration", async() => {
            await ftso.configureEpochs(2, 500, 2000, 10, 100, 1000, 10000, 50, {from: accounts[10]});
            let data = await ftso.epochsConfiguration();
            expect(data[0].toNumber()).to.equals(2);
            expect(data[1].toNumber()).to.equals(500);
            expect(data[2].toNumber()).to.equals(2000);
            expect(data[3].toNumber()).to.equals(10);
            expect(data[4].toNumber()).to.equals(100);
            expect(data[5].toNumber()).to.equals(1000);
            expect(data[6].toNumber()).to.equals(10000);
            expect(data[7].toNumber()).to.equals(50);
        });

        it("Should get fasset", async() => {
            let address = await ftso.getFAsset();
            expect(address).to.equals(mockVpToken.address);
        });

        it("Should not get fasset if multi fasset ftsos", async() => {
            ftso = await Ftso.new(
                mockWflr.address,
                constants.ZERO_ADDRESS,
                accounts[10]
            );
            let address = await ftso.getFAsset();
            expect(address).to.equals(constants.ZERO_ADDRESS);

            await ftso.setFAssetFtsos([accounts[1], accounts[2]], {from: accounts[10]});

            let address2 = await ftso.getFAsset();
            expect(address2).to.equals(constants.ZERO_ADDRESS);
        });

        it("Should get current price", async() => {
            let price = await ftso.getCurrentPrice();
            expect(price.toNumber()).to.equals(0);

            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> new current price = 250

            let price2 = await ftso.getCurrentPrice();
            expect(price2.toNumber()).to.equals(250);
        });

        it("Should get epoch price", async() => {
            let price = await ftso.getEpochPrice(epochId);
            expect(price.toNumber()).to.equals(0);

            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250

            let price2 = await ftso.getEpochPrice(epochId);
            expect(price2.toNumber()).to.equals(250);
            
            // round 2 - current fasset price = 250
            await ftso.submitPrice(soliditySha3(300, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(400, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(200, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            
            await time.increaseTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 2) * 120 + 60); // reveal period end
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

            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await time.increaseTo((epochId + 1) * 120); // reveal period start
            let random2 = await ftso.getCurrentRandom();
            expect(random2.toNumber()).to.equals(0);

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            let random3 = await ftso.getCurrentRandom();
            expect(random3.toNumber()).to.equals(123); // 123

            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            let random4 = await ftso.getCurrentRandom();
            expect(random4.toNumber()).to.equals(247); // 123 + 124

            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            let random5 = await ftso.getCurrentRandom();
            expect(random5.toNumber()).to.equals(372); // 123 + 124 + 125
            
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250

            let random6 = await ftso.getCurrentRandom();
            expect(random6.toNumber()).to.equals(372); // 123 + 124 + 125
            
            // round 2 - current fasset price = 250
            await ftso.submitPrice(soliditySha3(300, 223), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(400, 300), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(200, 23), {from: accounts[3]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 2) * 120); // reveal period start
            let random7 = await ftso.getCurrentRandom();
            expect(random7.toNumber()).to.equals(0); // new epoch with no reveals
            
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 223, {from: accounts[1]});
            let random8 = await ftso.getCurrentRandom();
            expect(random8.toNumber()).to.equals(223); // 223

            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 300, {from: accounts[2]});
            let random9 = await ftso.getCurrentRandom();
            expect(random9.toNumber()).to.equals(523); // 223 + 300

            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 23, {from: accounts[3]});
            let random10 = await ftso.getCurrentRandom();
            expect(random10.toNumber()).to.equals(546); // 223 + 300 + 23

            await time.increaseTo((epochId + 2) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId+1, false, {from: accounts[10]}); // finalize price -> epochId+1 price = 400

            let random11 = await ftso.getCurrentRandom();
            expect(random11.toNumber()).to.equals(546); // 223 + 300 + 23

            await time.increaseTo((epochId + 3) * 120); // reveal period start
            let random12 = await ftso.getCurrentRandom();
            expect(random12.toNumber()).to.equals(0);
        });

        it("Should get epoch price for voter", async() => {
            let price = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
            expect(price.toNumber()).to.equals(0);
            let price1 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
            expect(price1.toNumber()).to.equals(0);

            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await ftso.setVotePowerBlock(12, {from: accounts[10]});
            
            await time.increaseTo((epochId + 1) * 120); // reveal period start

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            let price2 = await ftso.getEpochPriceForVoter(epochId-1, accounts[1]);
            expect(price2.toNumber()).to.equals(0);
            let price3 = await ftso.getEpochPriceForVoter(epochId, accounts[1]);
            expect(price3.toNumber()).to.equals(500);
            let price4 = await ftso.getEpochPriceForVoter(epochId+1, accounts[1]);
            expect(price4.toNumber()).to.equals(0);

            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            let price5 = await ftso.getEpochPriceForVoter(epochId, accounts[2]);
            expect(price5.toNumber()).to.equals(250);
            
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]});
            
            // round 2 - current fasset price = 250
            await ftso.submitPrice(soliditySha3(300, 223), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(400, 300), {from: accounts[2]});
            
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 2) * 120); // reveal period start
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

        it("Should get current epoch data", async() => {
            let data = await ftso.getEpochData();
            expect(data[0].toNumber()).to.equals(epochId);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120 + 60);

            await time.increaseTo((epochId + 1) * 120 - 1);
            let data2 = await ftso.getEpochData();
            expect(data2[0].toNumber()).to.equals(epochId);
            expect(data2[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data2[2].toNumber()).to.equals((epochId+1) * 120 + 60);

            await time.increaseTo((epochId + 1) * 120);
            let data3 = await ftso.getEpochData();
            expect(data3[0].toNumber()).to.equals(epochId+1);
            expect(data3[1].toNumber()).to.equals((epochId+2) * 120);
            expect(data3[2].toNumber()).to.equals((epochId+2) * 120 + 60);
        });

        it("Should get current epoch id", async() => {
            let currentEpochId = await ftso.getCurrentEpochId();
            expect(currentEpochId.toNumber()).to.equals(epochId);

            await time.increaseTo((epochId + 1) * 120 - 1);
            let currentEpochId2 = await ftso.getCurrentEpochId();
            expect(currentEpochId2.toNumber()).to.equals(epochId);

            await time.increaseTo((epochId + 1) * 120);
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
            ftso = await Ftso.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10]
            );
            await ftso.initializeEpochs(500, 120, 60, {from: accounts[10]});

            let currentEpochId = await ftso.getEpochId(0);
            expect(currentEpochId.toString()).to.equals('0');

            ftso = await Ftso.new(
                mockWflr.address,
                mockVpToken.address,
                accounts[10]
            );
            await ftso.initializeEpochs(await time.latest() + 500, 120, 60, {from: accounts[10]});

            let currentEpochId1 = await ftso.getCurrentEpochId();
            expect(currentEpochId1.toString()).to.equals('0');

            let currentEpochId2 = await ftso.getEpochId(0);
            expect(currentEpochId2.toString()).to.equals('0');
        });

        it("Should get epoch info", async() => {
            let data;
            // before price submit
            data = await ftso.getEpoch(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120);
            expect(data[3].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(0);
            expect(data[8].toNumber()).to.equals(0);

            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start

            // before price reveal
            data = await ftso.getEpoch(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120);
            expect(data[3].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(0);
            expect(data[8].toNumber()).to.equals(10);

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            
            // before price finalization
            data = await ftso.getEpoch(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120);
            expect(data[3].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[4].toNumber()).to.equals(0);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(0);
            expect(data[7].toNumber()).to.equals(3);
            expect(data[8].toNumber()).to.equals(10);

            await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}); // finalize price -> epochId price = 250

            // after price finalization
            data = await ftso.getEpoch(epochId);
            expect(data[0].toNumber()).to.equals(epochId * 120);
            expect(data[1].toNumber()).to.equals((epochId+1) * 120);
            expect(data[2].toNumber()).to.equals((epochId+1) * 120);
            expect(data[3].toNumber()).to.equals((epochId+1) * 120 + 60);
            expect(data[4].toNumber()).to.equals(250);
            expect(data[5].toNumber()).to.equals(250);
            expect(data[6].toNumber()).to.equals(250);
            expect(data[7].toNumber()).to.equals(3);
            expect(data[8].toNumber()).to.equals(10);
        });

        it("Should not get epoch info for epoch in future", async() => {
            await expectRevert(ftso.getEpoch(epochId+1), "Unknown epoch");
        });
        
        it("Should get epoch votes", async() => {
            let data;
            // before price submit
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3].length).to.equals(0);
            expect(data[4].length).to.equals(0);

            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});
            await setMockVotePowerAt(10, 50000, 1000000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await time.increaseTo((epochId + 1) * 120); // reveal period start

            // before price reveal
            data = await ftso.getEpochVotes(epochId);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3].length).to.equals(0);
            expect(data[4].length).to.equals(0);

            await setMockVotePowerOfAt(10, 1000, 10000, accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAt(10, 5000, 0, accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAt(10, 0, 50000, accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});
            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            
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
            compareNumberArrays(data[2], [0,0,0]); // always 0 before _setWeightsParameters is called
            compareNumberArrays(data[3], weightsFlr);
            compareNumberArrays(data[4], [0, 0, 0]); // always 0 after first price finalization, as current price was 0
            compareArrays<boolean>(data[5], [true, false, false]); // TODO should not return true for first address before finalization???
            
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
            compareNumberArrays([data[2][id1], data[2][id2], data[2][id3]], [166666666666, 833333333333, 0]);
            compareNumberArrays([data[3][id1], data[3][id2], data[3][id3]], weightsFlr);
            compareNumberArrays([data[4][id1], data[4][id2], data[4][id3]], [0, 0, 0]); // always 0 after first price finalization, as current price was 0
            compareArrays<boolean>([data[5][id1], data[5][id2], data[5][id3]], [false, true, false]);

            await ftso.submitPrice(soliditySha3(300, 223), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(400, 300), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(200, 23), {from: accounts[3]});
            await setMockVotePowerAt(12, 20000, 100000);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});
            await time.increaseTo((epochId + 2) * 120); // reveal period start
            await setMockVotePowerOfAt(12, 2000, 0, accounts[1]);
            await ftso.revealPrice(epochId+1, 300, 223, {from: accounts[1]});
            await setMockVotePowerOfAt(12, 2000, 80000, accounts[2]);
            await ftso.revealPrice(epochId+1, 400, 300, {from: accounts[2]});
            await setMockVotePowerOfAt(12, 2000, 10000, accounts[3]);
            await ftso.revealPrice(epochId+1, 200, 23, {from: accounts[3]});
            await time.increaseTo((epochId + 2) * 120 + 60); // reveal period end

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
            compareNumberArrays(data[2], [0, 0, 0]);
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
            await expectRevert(ftso.getEpochVotes(epochId+1), "Unknown epoch");
        });

        it("Should get epoch reveal time left", async() => {
            let timeLeft = await ftso.getEpochRevealTimeLeft(0);
            expect(timeLeft.toNumber()).to.equals(0);

            let timeLeft2 = await ftso.getEpochRevealTimeLeft(epochId-2);
            expect(timeLeft2.toNumber()).to.equals(0);

            let timeLeft3 = await ftso.getEpochRevealTimeLeft(epochId-1);
            expect(timeLeft3.toNumber()).to.equals(0);

            let timeLeft4 = await ftso.getEpochRevealTimeLeft(epochId);
            expect(timeLeft4.toNumber()).to.equals(0);

            let timeLeft5 = await ftso.getEpochRevealTimeLeft(epochId+1);
            expect(timeLeft5.toNumber()).to.equals(0);

            await time.increaseTo((epochId + 1) * 120); // submit period end
            let timeLeft6 = await ftso.getEpochRevealTimeLeft(epochId);
            expect(timeLeft6.toNumber()).to.equals(0);
            
            await time.increaseTo((epochId + 1) * 120 + 1); // reveal period start
            let timeLeft7 = await ftso.getEpochRevealTimeLeft(epochId);
            expect(timeLeft7.toNumber()).to.equals(59);

            await time.increaseTo((epochId + 1) * 120 + 20); // in reveal period
            let timeLeft8 = await ftso.getEpochRevealTimeLeft(epochId);
            expect(timeLeft8.toNumber()).to.equals(40);

            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            let timeLeft9 = await ftso.getEpochRevealTimeLeft(epochId);
            expect(timeLeft9.toNumber()).to.equals(0);
        });
    });

    describe("multi fasset ftsos", async() => {
        beforeEach(async() => {
            wflrInterface = await Wflr.new();
            mockWflr = await MockWflr.new();
            vpTokenInterface = await VpToken.new("A token", "ATOK");
            mockFtsos = [];
            mockFtsos[0] = await MockFtso.new();
            mockFtsos[1] = await MockFtso.new();
            mockFtsos[2] = await MockFtso.new();
            mockVpTokens = [];
            mockVpTokens[0] = await MockVpToken.new();
            mockVpTokens[1] = await MockVpToken.new();
            mockVpTokens[2] = await MockVpToken.new();
            ftso = await Ftso.new(
                mockWflr.address,
                constants.ZERO_ADDRESS,
                accounts[10]
            );

            const decimals_vpToken = vpTokenInterface.contract.methods.decimals().encodeABI();
            const decimals3Return_vpToken = web3.eth.abi.encodeParameter('uint256', 3);
            await mockVpTokens[0].givenMethodReturn(decimals_vpToken, decimals3Return_vpToken);
            const decimals1Return_vpToken = web3.eth.abi.encodeParameter('uint256', 1);
            await mockVpTokens[1].givenMethodReturn(decimals_vpToken, decimals1Return_vpToken); 

            await ftso.setFAssetFtsos([mockFtsos[0].address, mockFtsos[1].address, mockFtsos[2].address], {from: accounts[10]});
            await ftso.configureEpochs(0, 1e10, 1e10, 1, 1, 1000, 10000, 50, {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.initializeEpochs(0, 120, 60, {from: accounts[10]});

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp / 120) + 1;
            await time.increaseTo(epochId * 120);
        });

        it("Should finalize price epoch with correct vote powers", async() => {
            await ftso.submitPrice(soliditySha3(500, 123), {from: accounts[1]});
            await ftso.submitPrice(soliditySha3(250, 124), {from: accounts[2]});
            await ftso.submitPrice(soliditySha3(400, 125), {from: accounts[3]});

            await setMockVotePowerAtMultiple(10, 50000, [5000000, 200000, 7500], [1000, 3, 800]);
            await ftso.initializeCurrentEpochStateForReveal({from: accounts[10]});

            await time.increaseTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAtMultiple(10, 1000, [1000000, 150000, 0], accounts[1]);
            await ftso.revealPrice(epochId, 500, 123, {from: accounts[1]});
            await setMockVotePowerOfAtMultiple(10, 5000, [0, 5000, 1000], accounts[2]);
            await ftso.revealPrice(epochId, 250, 124, {from: accounts[2]});
            await setMockVotePowerOfAtMultiple(10, 0, [500000, 0, 6000], accounts[3]);
            await ftso.revealPrice(epochId, 400, 125, {from: accounts[3]});

            await time.increaseTo((epochId + 1) * 120 + 60); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, {from: accounts[10]}), "PriceFinalized", {epochId: toBN(epochId), price: toBN(400), forced: false});

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
    });
});
