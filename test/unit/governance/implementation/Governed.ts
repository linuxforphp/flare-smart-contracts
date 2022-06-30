import { GovernanceAddressPointerInstance, GovernedInstance } from "../../../../typechain-truffle";

import { constants, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const Governed = artifacts.require("Governed");
const GovernanceAddressPointer = artifacts.require("GovernanceAddressPointer");

const ALREADY_INIT_MSG = "initialised != false";
const ONLY_GOVERNANCE_MSG = "only governance";
const GOVERNANCE_ZERO = "_governance zero";

contract(`Governed.sol; ${getTestFile(__filename)}; Governed unit tests`, async accounts => {
    const initialGovernance = accounts[1];
    const productionGovernance = accounts[2];

    // contains a fresh contract for each test
    let governed: GovernedInstance;
    let governanceAddressPointer: GovernanceAddressPointerInstance;

    beforeEach(async () => {
        governed = await Governed.new(initialGovernance);
        governanceAddressPointer = await GovernanceAddressPointer.new(productionGovernance);
    });

    describe("initialise", async () => {
        it("Should only initialize with non-zero governance", async () => {
            // Assemble
            // Act
            const promise = Governed.new(constants.ZERO_ADDRESS);
            // Assert
            await expectRevert(promise, GOVERNANCE_ZERO);
        });

        it("Should only be initializable once", async () => {
            // Assemble
            // Act
            const initPromise = governed.initialise(productionGovernance);
            // Assert
            await expectRevert(initPromise, ALREADY_INIT_MSG);
            // Original governance should still be set
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, initialGovernance);
        });
    });

    describe("switch to production", async () => {
        it("Should switch to production", async () => {
            // Assemble
            // Act
            const tx = await governed.switchToProductionMode(governanceAddressPointer.address, 10, { from: initialGovernance });
            // Assert
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, productionGovernance);
            expectEvent(tx, "GovernedProductionModeEntered", { governanceAddressPointer: governanceAddressPointer.address, timelock: "10" });
        });

        it("Should reject switch if not from governed address", async () => {
            // Assemble
            // Act
            const promiseTransfer = governed.switchToProductionMode(governanceAddressPointer.address, 10, { from: accounts[3] });
            // Assert
            await expectRevert(promiseTransfer, ONLY_GOVERNANCE_MSG);
        });

        it("Should not switch to production twice", async () => {
            // Assemble
            await governed.switchToProductionMode(governanceAddressPointer.address, 10, { from: initialGovernance });
            // Act
            const promiseTransfer1 = governed.switchToProductionMode(governanceAddressPointer.address, 10, { from: initialGovernance });
            // Assert
            await expectRevert(promiseTransfer1, ONLY_GOVERNANCE_MSG);
            // Act
            const promiseTransfer2 = governed.switchToProductionMode(governanceAddressPointer.address, 10, { from: productionGovernance });
            // Assert
            await expectRevert(promiseTransfer2, "already in production mode");
        });
        
        it("Should use valid governance pointer", async () => {
            // Assemble
            // Act
            const promiseTransfer1 = governed.switchToProductionMode(constants.ZERO_ADDRESS, 10, { from: initialGovernance });
            // Assert
            await expectRevert(promiseTransfer1, "invalid governance pointer");
            // Act
            const promiseTransfer2 = governed.switchToProductionMode(accounts[8], 10, { from: initialGovernance });
            // Assert
            await expectRevert(promiseTransfer2, "function call to a non-contract account");
        });
        
        it("Should have new governance parameters after switching", async () => {
            // Assemble
            const startGovernance = await governed.governance();
            const startTimelock = await governed.governanceTimelock();
            const startProductionMode = await governed.productionMode();
            // Act
            const tx = await governed.switchToProductionMode(governanceAddressPointer.address, 10, { from: initialGovernance });
            // Assert
            const newGovernance = await governed.governance();
            const newTimelock = await governed.governanceTimelock();
            const newProductionMode = await governed.productionMode();
            //
            assert.equal(startGovernance, initialGovernance);
            assert.equal(startTimelock.toNumber(), 0);
            assert.equal(startProductionMode, false);
            assert.equal(newGovernance, productionGovernance);
            assert.equal(newTimelock.toNumber(), 10);
            assert.equal(newProductionMode, true);
        });
    });
    
    describe("set executor", async () => {
        it("Should set executor", async () => {
            const startExecutor = await governed.governanceExecutor();
            await governed.setGovernanceExecutor(accounts[10], { from: initialGovernance });
            const executor = await governed.governanceExecutor();
            assert.equal(startExecutor, constants.ZERO_ADDRESS);
            assert.equal(executor, accounts[10]);
        });
        
        it("Should set executor immediately in production mode", async () => {
            const startExecutor = await governed.governanceExecutor();
            await governed.switchToProductionMode(governanceAddressPointer.address, 10, { from: initialGovernance });
            await governed.setGovernanceExecutor(accounts[10], { from: productionGovernance });
            const executor = await governed.governanceExecutor();
            assert.equal(startExecutor, constants.ZERO_ADDRESS);
            assert.equal(executor, accounts[10]);
        });

        it("Only governance can set executor", async () => {
            const promise = governed.setGovernanceExecutor(accounts[10], { from: accounts[5] });
            await expectRevert(promise, ONLY_GOVERNANCE_MSG);
        });
    });
});
