import { CleanupBlockNumberManagerInstance } from "../../../../typechain-truffle";
import { assertNumberEqual, getTestFile, toBN, ZERO_ADDRESS } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const { expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers');

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContract");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");

contract(`CleanupBlockNumberManager.sol; ${getTestFile(__filename)}; CleanupBlockNumberManager unit tests`, async accounts => {
    const governance = accounts[0];
    const trigger = accounts[10];
    let cbnManager: CleanupBlockNumberManagerInstance;

    beforeEach(async () => {
        cbnManager = await CleanupBlockNumberManager.new(governance);
        cbnManager.setTriggerContractAddress(trigger);
    });

    it("Can set trigger", async () => {
        // Assemble
        // Act
        await cbnManager.setTriggerContractAddress(accounts[5], { from: governance });
        // Assert
        assert.equal(await cbnManager.triggerContract(), accounts[5]);
    });

    it("Only governance can set trigger", async () => {
        // Assemble
        // Act
        // Assert
        await expectRevert(cbnManager.setTriggerContractAddress(accounts[5], { from: accounts[1] }),
            "only governance");
    });

    async function createVPToken(name: string, symbol: string) {
        const vpToken = await VPToken.new(governance, name, symbol);
        await setDefaultVPContract(vpToken, governance);
        return vpToken;
    }

    it("Can register contracts", async () => {
        // Assemble
        const vpToken = await createVPToken("A token", "ATOK");
        // Act
        await cbnManager.registerToken(vpToken.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken.address);
    });

    it("Only governance can register contracts", async () => {
        // Assemble
        const vpToken = await createVPToken("A token", "ATOK");
        // Act
        // Assert
        await expectRevert(cbnManager.registerToken(vpToken.address, { from: accounts[1] }),
            "only governance");
    });

    it("Can register multiple contracts", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        // Act
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken1.address);
        assert.equal(await cbnManager.registeredTokens(1), vpToken2.address);
    });

    it("Each contract is registered only once", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        // Act
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken1.address);
        assert.equal(await cbnManager.registeredTokens(1), vpToken2.address);
        await expectRevert(cbnManager.registeredTokens(2),
            "Transaction reverted without a reason");   // reading past array end
    });

    it("Can unregister contract", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        // Act
        await cbnManager.unregisterToken(vpToken1.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken2.address);
        await expectRevert(cbnManager.registeredTokens(1),
            "Transaction reverted without a reason");   // reading past array end
    });

    it("Unregistering contract that is not registered reverts", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        // Act
        // Assert
        await expectRevert(cbnManager.unregisterToken(vpToken2.address, { from: governance }),
            "contract not found");
    });

    it("Only governance can unregister contract", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        // Act
        // Assert
        await expectRevert(cbnManager.unregisterToken(vpToken1.address, { from: accounts[1] }),
            "only governance");
    });

    it("Register and unregister trigger events", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        // Act
        // Assert
        expectEvent(await cbnManager.registerToken(vpToken1.address, { from: governance }),
            "RegistrationUpdated", { theContract: vpToken1.address, add: true });
        expectEvent(await cbnManager.registerToken(vpToken2.address, { from: governance }),
            "RegistrationUpdated", { theContract: vpToken2.address, add: true });
        expectEvent.notEmitted(await cbnManager.registerToken(vpToken1.address, { from: governance }),
            "RegistrationUpdated");     // there should be no event when contract is already registered
        expectEvent(await cbnManager.unregisterToken(vpToken1.address, { from: governance }),
            "RegistrationUpdated", { theContract: vpToken1.address, add: false });
    });

    it("Can set cleanup block to one or more contracts", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await vpToken2.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        time.advanceBlock();
        // Act
        await cbnManager.setCleanUpBlockNumber(blk1, { from: governance });
        // Assert
        assertNumberEqual(await vpToken1.cleanupBlockNumber(), blk1);
        assertNumberEqual(await vpToken2.cleanupBlockNumber(), blk1);
    });

    it("Trigger can also set cleanup block", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        time.advanceBlock();
        // Act
        await cbnManager.setCleanUpBlockNumber(blk1, { from: trigger });
        // Assert
        assertNumberEqual(await vpToken1.cleanupBlockNumber(), blk1);
    });

    it("Only governance and trigger can set cleanup block", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        time.advanceBlock();
        // Act
        // Assert
        await expectRevert(cbnManager.setCleanUpBlockNumber(blk1, { from: accounts[1] }),
            "trigger or governance only");
    });

    it("Setting cleanup blocks emits events", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await vpToken2.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        time.advanceBlock();
        // Act
        const receipt = await cbnManager.setCleanUpBlockNumber(blk1, { from: governance });
        // Assert
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken1.address, blockNumber: toBN(blk1), success: true });
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken2.address, blockNumber: toBN(blk1), success: true });
    });

    it("Setting cleanup blocks fails silently if something is wrong", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await vpToken2.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        time.advanceBlock();
        // Act
        await vpToken1.setCleanupBlockNumber(blk1 + 1);
        await vpToken2.setCleanupBlockNumberManager(ZERO_ADDRESS, { from: governance });
        const receipt = await cbnManager.setCleanUpBlockNumber(blk1, { from: governance });
        // Assert
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken1.address, blockNumber: toBN(blk1), success: false });
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken2.address, blockNumber: toBN(blk1), success: false });
    });

    it("Can register detached VPContract directly", async () => {
        // Assemble
        const vpToken = await createVPToken("A token", "ATOK");
        await vpToken.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken.address, { from: governance });
        // Act
        const vpContract = await VPContract.at(await vpToken.readVotePowerContract());
        // detach vpContract from vpToken
        await vpToken.setWriteVpContract(ZERO_ADDRESS);
        await vpToken.setReadVpContract(ZERO_ADDRESS);
        // register vpContract to cbnManager
        await vpContract.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpContract.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken.address);
        assert.equal(await cbnManager.registeredTokens(1), vpContract.address);
        const blk1 = await web3.eth.getBlockNumber();
        time.advanceBlock();
        const receipt = await cbnManager.setCleanUpBlockNumber(blk1, { from: governance });
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken.address, blockNumber: toBN(blk1), success: true });
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpContract.address, blockNumber: toBN(blk1), success: true });
    });
});
