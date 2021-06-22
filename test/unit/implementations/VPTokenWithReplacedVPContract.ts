import { VPTokenMockInstance } from "../../../typechain-truffle";
import { compareArrays, toBN } from "../../utils/test-helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
const { constants, expectRevert, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContract");


contract(`VPToken.sol; ${getTestFile(__filename)}; VPToken with replaced VPContract tests`, async accounts => {

    // contains a fresh contract for each test
    let vpToken: VPTokenMockInstance;
    let initBlk1: number, initBlk2: number, initBlk3: number;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
        await setDefaultVPContract(vpToken, accounts[0]);
        
        // make some changes to vote power and delegation
        await vpToken.mint(accounts[1], 200);
        initBlk1 = await web3.eth.getBlockNumber();
        await vpToken.transfer(accounts[2], 100, { from: accounts[1] });
        initBlk2 = await web3.eth.getBlockNumber();
        await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
        await vpToken.delegate(accounts[3], 2000, { from: accounts[1] });
        await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[2] });
        initBlk3 = await web3.eth.getBlockNumber();
        // current vote powers: [1]: 50, [2]: 80, [3]: 70
        // without delegation: [1]: 100, [2]: 100, [3]: 0
        
        // replace VPContract
        const vpContractRepl = await VPContract.new(vpToken.address, true);
        await vpToken.setVpContract(vpContractRepl.address, { from: accounts[0] });
    });

    it("Should remember vote powers from balance, but not delegations", async () => {
        // Assemble
        // Act
        // Assert
        const vpTotal = await vpToken.votePower();
        assert.equal(vpTotal.toNumber(), 200);
        const vp1 = await vpToken.votePowerOf(accounts[1]);
        assert.equal(vp1.toNumber(), 100);
        const vp2 = await vpToken.votePowerOf(accounts[2]);
        assert.equal(vp2.toNumber(), 100);
        const vp3 = await vpToken.votePowerOf(accounts[3]);
        assert.equal(vp3.toNumber(), 0);
        const vp1h = await vpToken.votePowerOfAt(accounts[1], initBlk1);
        assert.equal(vp1h.toNumber(), 200);
        const vp2h = await vpToken.votePowerOfAt(accounts[2], initBlk1);
        assert.equal(vp2h.toNumber(), 0);
        const vp1to2 = await vpToken.votePowerFromTo(accounts[1], accounts[2]);
        assert.equal(vp1to2.toNumber(), 0);
        const vp2to3 = await vpToken.votePowerFromTo(accounts[2], accounts[3]);
        assert.equal(vp2to3.toNumber(), 0);
        const vp1to2h = await vpToken.votePowerFromToAt(accounts[1], accounts[2], initBlk3);
        assert.equal(vp1to2h.toNumber(), 0);
        const vp2to3h = await vpToken.votePowerFromToAt(accounts[2], accounts[3], initBlk3);
        assert.equal(vp2to3h.toNumber(), 0);
    });

    it("Undelegated vote powers should show no delegations", async () => {
        // Assemble
        // Act
        // Assert
        const vp1 = await vpToken.undelegatedVotePowerOf(accounts[1]);
        assert.equal(vp1.toNumber(), 100);
        const vp2 = await vpToken.undelegatedVotePowerOf(accounts[2]);
        assert.equal(vp2.toNumber(), 100);
        const vp3 = await vpToken.undelegatedVotePowerOf(accounts[3]);
        assert.equal(vp3.toNumber(), 0);
        const vp1h = await vpToken.undelegatedVotePowerOfAt(accounts[1], initBlk1);
        assert.equal(vp1h.toNumber(), 200);
        const vp2h = await vpToken.undelegatedVotePowerOfAt(accounts[2], initBlk1);
        assert.equal(vp2h.toNumber(), 0);
    });

    it("Cached vote power should work, too", async () => {
        // Assemble
        // Act
        await vpToken.votePowerAtCached(initBlk2);
        await vpToken.votePowerOfAtCached(accounts[1], initBlk2);
        await vpToken.votePowerOfAtCached(accounts[3], initBlk2);
        // Assert
        const vp = await vpToken.votePowerAtCached.call(initBlk2);
        assert.equal(vp.toNumber(), 200);
        const vp1 = await vpToken.votePowerOfAtCached.call(accounts[1], initBlk2);
        assert.equal(vp1.toNumber(), 100);
        const vp3 = await vpToken.votePowerOfAtCached.call(accounts[3], initBlk2);
        assert.equal(vp3.toNumber(), 0);
    });

    it("Should delegate after replacement", async () => {
        // Assemble
        // Act
        await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
        await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
        await vpToken.delegate(accounts[4], 1000, { from: accounts[1] });
        // Assert
        const vp1 = await vpToken.votePowerOf(accounts[1]);
        assert.equal(vp1.toNumber(), 40);
        const vp2 = await vpToken.votePowerOf(accounts[2]);
        assert.equal(vp2.toNumber(), 140);
        const vp3 = await vpToken.votePowerOf(accounts[3]);
        assert.equal(vp3.toNumber(), 10);
        const vp4 = await vpToken.votePowerOf(accounts[4]);
        assert.equal(vp4.toNumber(), 10);
    });

    it("Should delegate explicit after replacement", async () => {
        // Assemble
        // Act
        await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
        await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
        await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
        // Assert
        const vp1 = await vpToken.votePowerOf(accounts[1]);
        assert.equal(vp1.toNumber(), 40);
        const vp2 = await vpToken.votePowerOf(accounts[2]);
        assert.equal(vp2.toNumber(), 140);
        const vp3 = await vpToken.votePowerOf(accounts[3]);
        assert.equal(vp3.toNumber(), 10);
        const vp4 = await vpToken.votePowerOf(accounts[4]);
        assert.equal(vp4.toNumber(), 10);
    });

    it("Should undelegateAll after replacement", async () => {
        // Assemble
        await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
        await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
        await vpToken.delegate(accounts[4], 1000, { from: accounts[1] });
        // Act
        await vpToken.undelegateAll({ from: accounts[1] });
        // Assert
        const vp1 = await vpToken.votePowerOf(accounts[1]);
        assert.equal(vp1.toNumber(), 100);
        const vp2 = await vpToken.votePowerOf(accounts[2]);
        assert.equal(vp2.toNumber(), 100);
        const vp3 = await vpToken.votePowerOf(accounts[3]);
        assert.equal(vp3.toNumber(), 0);
        const vp4 = await vpToken.votePowerOf(accounts[4]);
        assert.equal(vp4.toNumber(), 0);
    });

    it("Should undelegateAllExplicit after replacement", async () => {
        // Assemble
        await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
        await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
        await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
        // Act
        await vpToken.undelegateAllExplicit([accounts[2], accounts[3], accounts[4], accounts[5]], { from: accounts[1] });
        // Assert
        const vp1 = await vpToken.votePowerOf(accounts[1]);
        assert.equal(vp1.toNumber(), 100);
        const vp2 = await vpToken.votePowerOf(accounts[2]);
        assert.equal(vp2.toNumber(), 100);
        const vp3 = await vpToken.votePowerOf(accounts[3]);
        assert.equal(vp3.toNumber(), 0);
        const vp4 = await vpToken.votePowerOf(accounts[4]);
        assert.equal(vp4.toNumber(), 0);
    });

    it("Should revoke delegation from before replacement (does nothing)", async () => {
        // Assemble
        // Act
        await vpToken.revokeDelegationAt(accounts[2], initBlk3, { from: accounts[1] });
        await vpToken.revokeDelegationAt(accounts[3], initBlk3, { from: accounts[2] });
        // Assert
        const vp1 = await vpToken.votePowerOfAt(accounts[1], initBlk3);
        assert.equal(vp1.toNumber(), 100);
        const vp2 = await vpToken.votePowerOfAt(accounts[2], initBlk3);
        assert.equal(vp2.toNumber(), 100);
        const vp3 = await vpToken.votePowerOfAt(accounts[3], initBlk3);
        assert.equal(vp3.toNumber(), 0);
    });

    it("Should revoke delegation after replacement", async () => {
        // Assemble
        await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
        await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
        const blk = await web3.eth.getBlockNumber();
        // Act
        await vpToken.revokeDelegationAt(accounts[2], blk, { from: accounts[1] });
        // Assert
        const vp1 = await vpToken.votePowerOfAt(accounts[1], blk);
        assert.equal(vp1.toNumber(), 90);
        const vp2 = await vpToken.votePowerOfAt(accounts[2], blk);
        assert.equal(vp2.toNumber(), 100);
        const vp3 = await vpToken.votePowerOfAt(accounts[3], blk);
        assert.equal(vp3.toNumber(), 10);
    });

});
