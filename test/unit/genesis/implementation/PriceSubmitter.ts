import { FtsoContract, FtsoInstance, MockContractContract, MockContractInstance, PriceSubmitterContract, PriceSubmitterInstance, WFlrContract, WFlrInstance } from "../../../../typechain-truffle";
import { increaseTimeTo, lastOf, submitPriceHash, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../../utils/constants').getTestFile;

const Wflr = artifacts.require("WFlr") as WFlrContract;
const MockWflr = artifacts.require("MockContract") as MockContractContract;
const MockSupply = artifacts.require("MockContract") as MockContractContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const PriceSubmitter = artifacts.require("PriceSubmitter") as PriceSubmitterContract;

// contains a fresh contract for each test 
let wflrInterface: WFlrInstance;
let mockWflr: MockContractInstance;
let mockSupply: MockContractInstance;
let ftsos: FtsoInstance[];
let priceSubmitter: PriceSubmitterInstance;
let epochId: number;

async function setMockVotePowerOfAt(blockNumber: number, wflrVotePower: number, address: string) {
    const votePowerOfAtCached_wflr = wflrInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
    const votePowerOfAtCachedReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenMethodReturn(votePowerOfAtCached_wflr, votePowerOfAtCachedReturn_wflr);
}

contract(`PriceSubmitter.sol; ${getTestFile(__filename)}; PriceSubmitter unit tests`, async accounts => {

    describe("submit and reveal price", async() => {
        beforeEach(async() => {
            ftsos = [];
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            mockSupply = await MockSupply.new();
            priceSubmitter = await PriceSubmitter.new();
            for (let i = 0; i < 3; i++) {
                let ftso = await Ftso.new(
                    "ATOK",
                    mockWflr.address,
                    accounts[10],
                    mockSupply.address,
                    1, // initial token price 0.00001$
                    1e10
                );
                await ftso.configureEpochs(1e10, 1e10, 1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
                await ftso.setVotePowerBlock(1, {from: accounts[10]});
                await ftso.activateFtso(priceSubmitter.address, 0, 120, 60, {from: accounts[10]});

                ftsos[i] = ftso;
            }

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should submit prices", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);
            let hash3 = submitPriceHash(300, 125, accounts[1]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            let tx = await priceSubmitter.submitPriceHashes(addresses, hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true, true]});
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceHashSubmitted"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceHashSubmitted"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceHashSubmitted"));
            expect(ftso0Event.args.submitter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.hash).to.equals(hashes[0]);
            expect(ftso1Event.args.submitter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.hash).to.equals(hashes[1]);
            expect(ftso2Event.args.submitter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.hash).to.equals(hashes[2]);
        });

        it("Should submit prices for all activated ftsos", async() => {
            let ftso = await Ftso.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                1, // initial token price 0.00001$
                1e10
            );
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);
            let addresses = [ftso.address, ftsos[1].address];
            let hashes = [hash1, hash2];
            let tx = await priceSubmitter.submitPriceHashes(addresses, hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [false, true]});
            let ftso0Events = await ftso.getPastEvents("PriceHashSubmitted");
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceHashSubmitted"));
            expect(ftso0Events.length).to.equals(0);
            expect(ftso1Event.args.submitter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.hash).to.equals(hashes[1]);
        });

        it("Should not submit price for ftso with another price submitter set", async() => {
            let ftso = await Ftso.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                1, // initial token price 0.00001$
                1e10
            );
            await ftso.configureEpochs(1e10, 1e10, 1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);
            let hash3 = submitPriceHash(300, 125, accounts[1]);
            let addresses = [ftso.address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            let tx = await priceSubmitter.submitPriceHashes(addresses, hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [false, true, true]});
            let ftso0Events = await ftso.getPastEvents("PriceHashSubmitted");
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceHashSubmitted"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceHashSubmitted"));
            expect(ftso0Events.length).to.equals(0);
            expect(ftso1Event.args.submitter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.hash).to.equals(hashes[1]);
            expect(ftso2Event.args.submitter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.hash).to.equals(hashes[2]);
        });

        it("Should reveal price", async() => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            let tx = await priceSubmitter.submitPriceHashes(addresses, hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true, true]});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(1, 10, accounts[1]);  // vote power of 0 is not allowed
            let tx2 = await priceSubmitter.revealPrices(epochId, addresses, prices, randoms, {from: accounts[1]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [true, true, true]});
            
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            expect(ftso0Event.args.voter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.price.toNumber()).to.equals(prices[0]);
            expect(ftso0Event.args.random.toNumber()).to.equals(randoms[0]);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso1Event.args.random.toNumber()).to.equals(randoms[1]);
            expect(ftso2Event.args.voter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.price.toNumber()).to.equals(prices[2]);
            expect(ftso2Event.args.random.toNumber()).to.equals(randoms[2]);
        });

        it("Should reveal prices for all activated ftsos in correct state", async() => {
            let ftso = await Ftso.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                1, // initial token price 0.00001$
                1e10
            );
            
            let prices = [500, 200, 300, 100];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125, 126];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftso.address, ftsos[0].address, ftsos[1].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            let tx = await priceSubmitter.submitPriceHashes(addresses, hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [false, true, true]});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(1, 10, accounts[1]);  // vote power of 0 is not allowed
            addresses.push(ftsos[2].address);
            let tx2 = await priceSubmitter.revealPrices(epochId, addresses, prices, randoms, {from: accounts[1]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [false, true, false, false]});
            let ftso0Events = await ftso.getPastEvents("PriceRevealed"); // not active
            let ftso1Event = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            let ftso2Events = await ftsos[1].getPastEvents("PriceRevealed"); // not initialized
            let ftso3Events = await ftsos[2].getPastEvents("PriceRevealed");
            expect(ftso0Events.length).to.equals(0);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso1Event.args.random.toNumber()).to.equals(randoms[1]);
            expect(ftso2Events.length).to.equals(0);
            expect(ftso3Events.length).to.equals(0);
        });

        it("Should not reveal price for ftso with another price submitter set", async() => {
            let ftso = await Ftso.new(
                "ATOK",
                mockWflr.address,
                accounts[10],
                mockSupply.address,
                1, // initial token price 0.00001$
                1e10
            );
            await ftso.configureEpochs(1e10, 1e10, 1, 1, 1000, 10000, 50, 500, [accounts[5], accounts[6], accounts[7]], {from: accounts[10]});
            await ftso.setVotePowerBlock(10, {from: accounts[10]});
            await ftso.activateFtso(accounts[4], 0, 120, 60, {from: accounts[10]});

            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftso.address, ftsos[1].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            let tx = await priceSubmitter.submitPriceHashes(addresses, hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [false, true, true]});
            await ftso.initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(1, 10, accounts[1]);  // vote power of 0 is not allowed
            let tx2 = await priceSubmitter.revealPrices(epochId, addresses, prices, randoms, {from: accounts[1]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [false, true, true]});
            let ftso0Events = await ftso.getPastEvents("PriceRevealed");
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            expect(ftso0Events.length).to.equals(0);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso1Event.args.random.toNumber()).to.equals(randoms[1]);
            expect(ftso2Event.args.voter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.price.toNumber()).to.equals(prices[2]);
            expect(ftso2Event.args.random.toNumber()).to.equals(randoms[2]);
        });

        it("Should not allow price shadowing", async () => {
            // Thist tests against an attacker that just copies submitted commit hash and sends 
            // the same revealed price without doing anything else
            // This is mitigated by including sender's address in the hash before reveal.
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            let hashesAttacker = Array.from(hashes) // Copy sent hashes

            let tx = await priceSubmitter.submitPriceHashes(addresses, hashes, {from: accounts[1]});
            let txAttacker = await priceSubmitter.submitPriceHashes(addresses, hashesAttacker, {from: accounts[2]});

            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true, true]});
            expectEvent(txAttacker, "PriceHashesSubmitted", {submitter: accounts[2], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true, true]});
            
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            await setMockVotePowerOfAt(1, 10, accounts[1]);  // vote power of 0 is not allowed
            await setMockVotePowerOfAt(1, 10, accounts[2]);  // vote power of 0 is not allowed
            let tx2 = await priceSubmitter.revealPrices(epochId, addresses, prices, randoms, {from: accounts[1]});

            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [true, true, true]});

            const f0e1 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e1 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            const f2e1 = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));

            // First submit should succeed
            expect(f0e1.args.voter).to.equals(accounts[1]);
            expect(f0e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f0e1.args.price.toNumber()).to.equals(prices[0]);
            expect(f0e1.args.random.toNumber()).to.equals(randoms[0]);
            expect(f1e1.args.voter).to.equals(accounts[1]);
            expect(f1e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f1e1.args.price.toNumber()).to.equals(prices[1]);
            expect(f1e1.args.random.toNumber()).to.equals(randoms[1]);
            expect(f2e1.args.voter).to.equals(accounts[1]);
            expect(f2e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f2e1.args.price.toNumber()).to.equals(prices[2]);
            expect(f2e1.args.random.toNumber()).to.equals(randoms[2]);

            // Just copy the first node
            let tx2Attacker = await priceSubmitter.revealPrices(epochId, addresses, prices, randoms, {from: accounts[2]});

            // Copy attacker should not succeed in submitting the final price
            expectEvent(tx2Attacker, "PricesRevealed", {voter: accounts[2], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [false, false, false]});
            
            // No correct prices should be revealed
            const f0e2 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e2 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            const f2e2 = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            
            assert.isUndefined(f0e2);
            assert.isUndefined(f1e2);
            assert.isUndefined(f2e2);

        });
    });
});
