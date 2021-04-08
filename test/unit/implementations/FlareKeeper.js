const {expectRevert, expectEvent} = require('@openzeppelin/test-helpers');

const FlareKeeper = artifacts.require("FlareKeeper");
const MockContract = artifacts.require("MockContract");

const ONLY_GOVERNANCE_MSG = "only governance";
const TOO_MANY_CONTRACTS_MSG = "Too many contracts";
const CANT_FIND_CONTRACT_MSG = "Can't find contract";
const REGISTRATIONUPDATED_EVENT = "RegistrationUpdated";


contract(`FlareKeeper unit tests`, async accounts => {
    // contains a fresh contract for each test
    let flareKeeper;
    let mockContractToKeep;

    beforeEach(async() => {
        flareKeeper = await FlareKeeper.new();
        mockContractToKeep = await MockContract.new();
    });

    describe("register", async() => {
        it("Should register a contract to keep", async() => {
            // Assemble
            await flareKeeper.initialise(accounts[1]);
            // Act
            const tx = await flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Assert
            const keptContract = await flareKeeper.keepContracts(0);
            assert.equal(keptContract, mockContractToKeep.address);
            expectEvent(tx, REGISTRATIONUPDATED_EVENT);
        });

        it("Should reject contract registration if not from governed", async() => {
            // Assemble
            await flareKeeper.initialise(accounts[1]);
            // Act
            const registerPromise = flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[2]});
            // Assert
            await expectRevert(registerPromise, ONLY_GOVERNANCE_MSG);
        });

        it("Should not register a dup contract", async() => {
            // Assemble
            await flareKeeper.initialise(accounts[1]);
            await flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Act
            const tx = await flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Assert
            const promise = flareKeeper.keepContracts(1);
            await expectRevert.unspecified(promise);
            expectEvent.notEmitted(tx, REGISTRATIONUPDATED_EVENT);
        });

        it("Should not register more contracts than allowable", async() => {
            // Assemble
            await flareKeeper.initialise(accounts[1]);
            const MAX = await flareKeeper.MAX_KEEP_CONTRACTS();
            for (i = 0; i < MAX-1; i++ ) {
                const contract = await MockContract.new();
                await flareKeeper.registerToKeep(contract.address, {from: accounts[1]});
            }
            // Act
            const registerPromise = flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Assert
            await expectRevert(registerPromise, TOO_MANY_CONTRACTS_MSG);
        });
    });

    describe("unregister", async() => {
        it("Should unregister a kept contract", async() => {
            // Assemble
            await flareKeeper.initialise(accounts[1]);
            await flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Act
            const tx = await flareKeeper.unregisterToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Assert
            const promise = flareKeeper.keepContracts(0);
            await expectRevert.unspecified(promise);
            expectEvent(tx, REGISTRATIONUPDATED_EVENT);
        });

        it("Should not unregister a kept contract not found", async() => {
            // Assemble
            await flareKeeper.initialise(accounts[1]);
            // Act
            const unregisterPromise = flareKeeper.unregisterToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Assert
            await expectRevert(unregisterPromise, CANT_FIND_CONTRACT_MSG);
        });

        it("Should reject contract unregistration if not from governed", async() => {
            // Assemble
            await flareKeeper.initialise(accounts[1]);
            // Act
            const unregisterPromise = flareKeeper.unregisterToKeep(mockContractToKeep.address, {from: accounts[2]});
            // Assert
            await expectRevert(unregisterPromise, ONLY_GOVERNANCE_MSG);
        });
    });

    describe("keep", async() => {
        it("Should keep a contract", async() => {
            // Assemble
            const keep = web3.utils.sha3("keep()").slice(0,10); // first 4 bytes is function selector
            await mockContractToKeep.givenMethodReturnBool(keep, true);
            await flareKeeper.initialise(accounts[1]);
            await flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[1]});
            // Act
            await flareKeeper.trigger();
            // Assert
            const invocationCount = await mockContractToKeep.invocationCountForMethod.call(keep);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should advance last triggered block", async() => {
            // Assemble
            const oldLastTriggeredBlock = await flareKeeper.systemLastTriggeredAt();
            // Act
            await flareKeeper.trigger();
            // Assert
            const currentBlock = await web3.eth.getBlockNumber();            
            const lastTriggeredBlock = await flareKeeper.systemLastTriggeredAt();
            assert(lastTriggeredBlock.toNumber() > oldLastTriggeredBlock.toNumber());
            assert.equal(lastTriggeredBlock.toNumber(), currentBlock);
        });

        // TODO: Test reject if trigger called more than once for same block; HH advances the block for every call.
        // Not sure how to do this in an automated manner.
    });
});