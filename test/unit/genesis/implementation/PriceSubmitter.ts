import { FtsoContract, FtsoInstance, MockContractContract, MockContractInstance, PriceSubmitterContract, PriceSubmitterInstance, WFlrContract, WFlrInstance } from "../../../../typechain-truffle";
import { increaseTimeTo, lastOf, submitPriceHash, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../../utils/constants').getTestFile;

const Wflr = artifacts.require("WFlr") as WFlrContract;
const MockWflr = artifacts.require("MockContract") as MockContractContract;
const MockSupply = artifacts.require("MockContract") as MockContractContract;
const MockRegistry = artifacts.require("MockContract") as MockContractContract;
const MockFtso = artifacts.require("MockContract") as MockContractContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const PriceSubmitter = artifacts.require("PriceSubmitter") as PriceSubmitterContract;
const genesisGovernance = require('../../../utils/constants').genesisGovernance;

const ERR_TO_MANY_REVERTS = "Too many reverts";
const ERR_FAIL_PRECHECK = "Insufficient listed vote power"

// contains a fresh contract for each test 
let wflrInterface: WFlrInstance;
let mockWflr: MockContractInstance;
let mockSupply: MockContractInstance;
let mockFtsoRegistry: MockContractInstance;
let mockFtso: MockContractInstance;
let ftsos: FtsoInstance[];
let priceSubmitter: PriceSubmitterInstance;
let epochId: number;


async function setMockVotePowerOfAt(blockNumber: number, wflrVotePower: number, address: string) {
    const votePowerOfAtCached_wflr = wflrInterface.contract.methods.votePowerOfAtCached(address, blockNumber).encodeABI();
    const votePowerOfAtCachedReturn_wflr = web3.eth.abi.encodeParameter('uint256', wflrVotePower);
    await mockWflr.givenMethodReturn(votePowerOfAtCached_wflr, votePowerOfAtCachedReturn_wflr);
}

contract(`PriceSubmitter.sol; ${getTestFile(__filename)}; PriceSubmitter unit tests`, async accounts => {

    const FTSO_MANAGER_ADDRESS = accounts[12];

    describe("submit and reveal price", async() => {
        beforeEach(async() => {
            ftsos = [];
            wflrInterface = await Wflr.new(accounts[0]);
            await setDefaultVPContract(wflrInterface, accounts[0]);
            mockWflr = await MockWflr.new();
            mockSupply = await MockSupply.new();
            mockFtsoRegistry = await MockRegistry.new();
            priceSubmitter = await PriceSubmitter.new();
            priceSubmitter.initialiseFixedAddress();
            
            priceSubmitter.setFtsoManager(FTSO_MANAGER_ADDRESS, {from: genesisGovernance});

            for (let i = 0; i < 3; i++) {
                let ftso = await Ftso.new(
                    `ATOK${i}`,
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

            await priceSubmitter.setFtsoRegistry(mockFtsoRegistry.address, {from: genesisGovernance});

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndicesAndFtsos", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameters(["uint256[]", "address[]"], [[...Array(ftsos.length).keys()], ftsos.map(ftso => ftso.address)]);
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);
            for(let i = 0; i < ftsos.length; ++i){
                await mockFtsoRegistry.givenCalldataReturnAddress(
                    web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, [`${i}`]), 
                    ftsos[i].address
                    );
                
                priceSubmitter.addFtso(ftsos[i].address, i, {from: FTSO_MANAGER_ADDRESS});
            }

            // Force a block in order to get most up to date time
            await time.advanceBlock();
            // Get the timestamp for the just mined block
            let timestamp = await time.latest();
            epochId = Math.floor(timestamp / 120) + 1;
            await increaseTimeTo(epochId * 120);
        });

        it("Should work with deleted ftsos", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash3 = submitPriceHash(300, 125, accounts[1]);
            let addresses = [ftsos[0].address, ftsos[2].address];
            let hashes = [hash1, hash3];

            await ftsos[1].deactivateFtso({from: accounts[10]});
            await priceSubmitter.removeFtso(ftsos[1].address, {from: FTSO_MANAGER_ADDRESS});

            await setMockVotePowerOfAt(1, 10, accounts[1]); 
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[1]);
            let tx = await priceSubmitter.submitPriceHashes([0, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true]});
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceHashSubmitted"));

            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceHashSubmitted"));
            expect(ftso0Event.args.submitter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.hash).to.equals(hashes[0]);
            expect(ftso2Event.args.submitter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.hash).to.equals(hashes[1]);
        });

        it("Should allow voting on only fasset vote power", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash3 = submitPriceHash(300, 125, accounts[1]);

            let mockFtso1 = await MockFtso.new()
            let mockFtso2 = await MockFtso.new()
            let mockFtso3 = await MockFtso.new()

            await mockFtsoRegistry.givenCalldataReturnAddress(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, ["3"]), 
                mockFtso1.address
                );
            
            await mockFtsoRegistry.givenCalldataReturnAddress(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, ["4"]), 
                mockFtso2.address
                );
            await mockFtsoRegistry.givenCalldataReturnAddress(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "getFtso", inputs: [{name: "_ftsoIndex", type: "uint256"}]} as AbiItem, ["5"]), 
                mockFtso3.address
                );

            const getSupportedSymbolsAndFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedIndicesAndFtsos", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameters(
                ["uint256[]", "address[]"], [[...Array(ftsos.length).keys(), 3, 4, 5], 
                ftsos.map(ftso => ftso.address).concat(mockFtso1.address, mockFtso2.address) ]);
            await mockFtsoRegistry.givenCalldataReturn(getSupportedSymbolsAndFtsos, supportedFtsos);
            
            await mockFtso1.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "symbol", inputs: []} as AbiItem, []),
                web3.eth.abi.encodeParameter("string", "MOCK_1")
            );

            await mockFtso2.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "symbol", inputs: []} as AbiItem, []),
                web3.eth.abi.encodeParameter("string", "MOCK_2")
            );

            await mockFtso3.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({type: "function", name: "symbol", inputs: []} as AbiItem, []),
                web3.eth.abi.encodeParameter("string", "MOCK_3")
            );

            await mockFtso1.givenMethodReturnBool(
                ftsos[0].contract.methods.hasSufficientFassetVotePower(accounts[0]).encodeABI(),
                true
            );
            
            await mockFtso1.givenMethodReturnUint(
                web3.utils.sha3("submitPriceHashSubmitter(address,bytes32)")!.slice(0,10),
                epochId
            );

            await mockFtso2.givenMethodReturnBool(
                ftsos[1].contract.methods.hasSufficientFassetVotePower(accounts[1]).encodeABI(),
                false
            );

            await mockFtso3.givenMethodReturnBool(
                ftsos[0].contract.methods.hasSufficientFassetVotePower(accounts[2]).encodeABI(),
                true
            );

            await mockFtso3.givenMethodReturnUint(
                web3.utils.sha3("submitPriceHashSubmitter(address,bytes32)")!.slice(0,10),
                epochId
            );

            await priceSubmitter.addFtso(mockFtso1.address, 3, {from: FTSO_MANAGER_ADDRESS});
            await priceSubmitter.addFtso(mockFtso2.address, 4, {from: FTSO_MANAGER_ADDRESS});
            await priceSubmitter.addFtso(mockFtso3.address, 5, {from: FTSO_MANAGER_ADDRESS});

            let addresses = [mockFtso1.address, mockFtso3.address];
            let hashes = [hash1, hash3];

            await setMockVotePowerOfAt(0, 10, accounts[1]);

            await priceSubmitter.requestFtsoWhiteListingFassetHolder(accounts[1], 4);

            await priceSubmitter.requestFtsoWhiteListingFassetHolder(accounts[1], 3);

            await priceSubmitter.requestFtsoWhiteListingFassetHolder(accounts[1], 5);

            let faultyTransaction = priceSubmitter.submitPriceHashes([3, 4, 5], [hash1, hash1, hash1], {from: accounts[1]});
            expectRevert(faultyTransaction, ERR_FAIL_PRECHECK);

            let tx = await priceSubmitter.submitPriceHashes([3, 5], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true]});
        });

        it("Should submit with precheck", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);

            const getSupportedFtsos = web3.eth.abi.encodeFunctionCall({type: "function", name: "getSupportedFtsos", inputs: []} as AbiItem, []);
            const supportedFtsos = web3.eth.abi.encodeParameter("address[]", ftsos.map(ftso => ftso.address));
            await mockFtsoRegistry.givenCalldataReturn(getSupportedFtsos, supportedFtsos);

            const failPrecheckPromise = priceSubmitter.submitPriceHashes([0, 1], [hash1, hash2]);
            expectRevert(failPrecheckPromise, ERR_FAIL_PRECHECK);

            await setMockVotePowerOfAt(1, 10, accounts[10]);  
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[10]);

            await priceSubmitter.submitPriceHashes([0, 1], [hash1, hash2], {from: accounts[10]});
            
            await setMockVotePowerOfAt(1, 0, accounts[10]);
            await priceSubmitter.requestFtsoWhiteListingWflrHolder(accounts[10]);
            expectRevert(priceSubmitter.submitPriceHashes([0, 1], [hash1, hash2], {from: accounts[10]}), ERR_FAIL_PRECHECK);

        });

        it("Should submit prices", async() => {
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);
            let hash3 = submitPriceHash(300, 125, accounts[1]);
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [hash1, hash2, hash3];
            await setMockVotePowerOfAt(1, 10, accounts[1]); 
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[1]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[1]});
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
            let hash1 = submitPriceHash(500, 123, accounts[1]);
            let hash2 = submitPriceHash(200, 124, accounts[1]);

            await setMockVotePowerOfAt(1, 10, accounts[1]); 
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[1]);

            await ftsos[0].deactivateFtso({from: accounts[10]});
            await priceSubmitter.removeFtso(ftsos[0].address, {from: FTSO_MANAGER_ADDRESS});

            let addresses = [ftsos[0].address, ftsos[1].address];
            let hashes = [hash1, hash2];
            
            let tx = await priceSubmitter.submitPriceHashes([0, 1], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), 
                ftsos: addresses, hashes: hashes, success: [false, true]});
            let ftso0Events = await ftsos[0].getPastEvents("PriceHashSubmitted");
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceHashSubmitted"));
            expect(ftso0Events.length).to.equals(0);
            expect(ftso1Event.args.submitter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.hash).to.equals(hashes[1]);
        });

        it("Should reveal price", async() => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await setMockVotePowerOfAt(1, 10, accounts[1]); 
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[1]);
            
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true, true]});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1, 2], prices, randoms, {from: accounts[1]});
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

        it("Should submit and reveal price in arbitrary order", async() => {
            let prices = [500, 200, 300];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, 125];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[1].address, ftsos[0].address, ftsos[2].address];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1]), submitPriceHash(prices[2], randoms[2], accounts[1])];
            
            await setMockVotePowerOfAt(1, 10, accounts[1]); 
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[1]);
            
            let tx = await priceSubmitter.submitPriceHashes([1, 0, 2], hashes, {from: accounts[1]});
            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true, true]});
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});

            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [1, 0, 2], prices, randoms, {from: accounts[1]});
            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [true, true, true]});
            
            let ftso0Event = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            let ftso1Event = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            let ftso2Event = lastOf(await ftsos[2].getPastEvents("PriceRevealed"));
            expect(ftso0Event.args.voter).to.equals(accounts[1]);
            expect(ftso0Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso0Event.args.price.toNumber()).to.equals(prices[1]);
            expect(ftso0Event.args.random.toNumber()).to.equals(randoms[1]);
            expect(ftso1Event.args.voter).to.equals(accounts[1]);
            expect(ftso1Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso1Event.args.price.toNumber()).to.equals(prices[0]);
            expect(ftso1Event.args.random.toNumber()).to.equals(randoms[0]);
            expect(ftso2Event.args.voter).to.equals(accounts[1]);
            expect(ftso2Event.args.epochId.toNumber()).to.equals(epochId);
            expect(ftso2Event.args.price.toNumber()).to.equals(prices[2]);
            expect(ftso2Event.args.random.toNumber()).to.equals(randoms[2]);
        });

        it("Should not allow price shadowing", async () => {
            // Thist tests against an attacker that just copies submitted commit hash and sends 
            // the same revealed price without doing anything else
            // This is mitigated by including sender's address in the hash before reveal.
            let prices = [500, 200, ];
            let pricesBN = prices.map(x => toBN(x));
            let randoms = [123, 124, ];
            let randomsBN = randoms.map(x => toBN(x));
            let addresses = [ftsos[0].address, ftsos[1].address,];
            let hashes = [submitPriceHash(prices[0], randoms[0], accounts[1]), submitPriceHash(prices[1], randoms[1], accounts[1])];
            let hashesAttacker = Array.from(hashes) // Copy sent hashes

            await setMockVotePowerOfAt(1, 10, accounts[1]); 
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[1]);
            await setMockVotePowerOfAt(1, 10, accounts[2]); 
            await priceSubmitter.requestFtsoFullVoterWhitelisting(accounts[2]);

            let tx = await priceSubmitter.submitPriceHashes([0, 1], hashes, {from: accounts[1]});
            let txAttacker = await priceSubmitter.submitPriceHashes([0, 1], hashesAttacker, {from: accounts[2]});

            expectEvent(tx, "PriceHashesSubmitted", {submitter: accounts[1], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true]});
            expectEvent(txAttacker, "PriceHashesSubmitted", {submitter: accounts[2], epochId: toBN(epochId), ftsos: addresses, hashes: hashes, success: [true, true]});
            
            await ftsos[0].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[1].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            await ftsos[2].initializeCurrentEpochStateForReveal(false, {from: accounts[10]});
            
            await increaseTimeTo((epochId + 1) * 120); // reveal period start
            let tx2 = await priceSubmitter.revealPrices(epochId, [0, 1], prices, randoms, {from: accounts[1]});

            expectEvent(tx2, "PricesRevealed", {voter: accounts[1], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [true, true]});

            const f0e1 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e1 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));

            // First submit should succeed
            expect(f0e1.args.voter).to.equals(accounts[1]);
            expect(f0e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f0e1.args.price.toNumber()).to.equals(prices[0]);
            expect(f0e1.args.random.toNumber()).to.equals(randoms[0]);
            expect(f1e1.args.voter).to.equals(accounts[1]);
            expect(f1e1.args.epochId.toNumber()).to.equals(epochId);
            expect(f1e1.args.price.toNumber()).to.equals(prices[1]);
            expect(f1e1.args.random.toNumber()).to.equals(randoms[1]);

            let tx2Attacker = await priceSubmitter.revealPrices(epochId, [0, 1], prices, randoms, {from: accounts[2]});
            // Copy attacker should not succeed in submitting the final price
            expectEvent(tx2Attacker, "PricesRevealed", {voter: accounts[2], epochId: toBN(epochId), ftsos: addresses, prices: pricesBN, randoms: randomsBN, success: [false, false]});
            
            // No correct prices should be revealed
            const f0e2 = lastOf(await ftsos[0].getPastEvents("PriceRevealed"));
            const f1e2 = lastOf(await ftsos[1].getPastEvents("PriceRevealed"));
            
            assert.isUndefined(f0e2);
            assert.isUndefined(f1e2);

        });
    });
});
