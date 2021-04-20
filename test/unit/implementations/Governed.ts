import { GovernedInstance } from "../../../typechain-truffle";

const {constants, expectRevert, expectEvent} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const Governed = artifacts.require("Governed");

const ALREADY_INIT_MSG = "initialised != false";
const ONLY_GOVERNANCE_MSG = "only governance";
const NOT_CLAIMAINT = "not claimaint";

const GOVERNANCEUPDATED_EVENT = "GovernanceUpdated";

contract(`Governed.sol; ${getTestFile(__filename)}; Governed unit tests`, async accounts => {
    // contains a fresh contract for each test
    let governed: GovernedInstance;

    beforeEach(async() => {
        governed = await Governed.new(constants.ZERO_ADDRESS);
    });

    describe("initialise", async() => {
        it("Should initialize with parameterized governance", async() => {
            // Assemble
            // Act
            const tx = await governed.initialise(accounts[1]);
            // Assert
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, accounts[1]);
            expectEvent(tx, GOVERNANCEUPDATED_EVENT);
        });

        it("Should only be initializable once", async() => {
            // Assemble
            await governed.initialise(accounts[1]);
            // Act
            const initPromise = governed.initialise(accounts[2]);
            // Assert
            await expectRevert(initPromise, ALREADY_INIT_MSG);
            // Original governance should still be set
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, accounts[1]);
        });
    });

    describe("propose", async() => {
        it("Should accept a governance proposal", async() => {
            // Assemble
            await governed.initialise(accounts[1]);
            // Act
            const tx = await governed.proposeGovernance(accounts[2], {from: accounts[1]});
            // Assert
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, accounts[1]);
            const proposedGovernance = await governed.proposedGovernance();
            assert.equal(proposedGovernance, accounts[2]);
            expectEvent.notEmitted(tx, GOVERNANCEUPDATED_EVENT);
        });

        it("Should reject a governance proposal if not proposed from governed address", async() => {
            // Assemble
            await governed.initialise(accounts[1]);
            // Act
            const proposePromise = governed.proposeGovernance(accounts[2]);
            // Assert
            await expectRevert(proposePromise, ONLY_GOVERNANCE_MSG);
        });
    });

    describe("claim", async() => {
        it("Should claim a governance proposal", async() => {
            // Assemble
            await governed.initialise(accounts[1]);
            await governed.proposeGovernance(accounts[2], {from: accounts[1]});
            // Act
            const tx = await governed.claimGovernance({from: accounts[2]});
            // Assert
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, accounts[2]);
            expectEvent(tx, GOVERNANCEUPDATED_EVENT);
        });

        it("Should reject a governance claim if not from claimaint", async() => {
            // Assemble
            await governed.initialise(accounts[1]);
            await governed.proposeGovernance(accounts[2], {from: accounts[1]});
            // Act
            const claimPromise = governed.claimGovernance();
            // Assert
            await expectRevert(claimPromise, NOT_CLAIMAINT);
        });
    });
});
