import { soliditySha3Raw as soliditySha3 } from "web3-utils";
import { FlashLenderMockInstance, FlashLoanMockInstance, FtsoInstance, VotingFlashLoanMockInstance, VPTokenInstance, WFlrInstance } from "../../../typechain-truffle";
import { increaseTimeTo, submitPriceHash, toBN } from "../../utils/test-helpers";
const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { getTestFile } = require('../../utils/constants');

const FlashLenderMock = artifacts.require("FlashLenderMock");
const FlashLoanMock = artifacts.require("FlashLoanMock");
const VotingFlashLoanMock = artifacts.require("VotingFlashLoanMock");
const Wflr = artifacts.require("WFlr");
const Ftso = artifacts.require("Ftso");

const FLARE = toBN(1e18);

const LENDER_AMOUNT = toBN(20).mul(FLARE);
const AMOUNT = toBN(1).mul(FLARE);

async function startNewEpoch() {
    await time.advanceBlock();
    let timestamp = await time.latest();
    const epochId = Math.floor(timestamp / 120) + 1;
    await increaseTimeTo(epochId * 120, 'web3');
    return epochId;
}

contract(`FlashLoanMock.sol; ${getTestFile(__filename)}; FlashLoanMock unit tests`, async accounts => {
    let flashLenderMock: FlashLenderMockInstance;
    let flashLoanMock: FlashLoanMockInstance;
    let votingFlashLoanMock: VotingFlashLoanMockInstance;
    let wflr: WFlrInstance;
    let vpToken: VPTokenInstance;
    let ftso: FtsoInstance;
    let epochId: number;
    
    describe("take a loan", async () => {
        beforeEach(async () => {
            flashLenderMock = await FlashLenderMock.new();
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);
            await flashLenderMock.send(LENDER_AMOUNT);
        });

        it("Should take a flash loan", async () => {
            await flashLoanMock.testRequestLoan(AMOUNT);
        })
    });

    describe("vote with real flares", async () => {
        beforeEach(async () => {
            wflr = await Wflr.new();
            ftso = await Ftso.new(
                "ATOK",
                wflr.address,
                accounts[10],
                1
            );
            await ftso.configureEpochs(10, 10, 1, 1, 1000, 10000, 500, 500, [], { from: accounts[10] });
            await ftso.activateFtso(accounts[4], 0, 120, 60, { from: accounts[10] });
            // init lender
            flashLenderMock = await FlashLenderMock.new();
            await flashLenderMock.send(LENDER_AMOUNT);
            await time.advanceBlock();
            // give dummy user wflrs to create vote threshold
            const accountAmount = toBN(3).mul(AMOUNT);
            await flashLenderMock.donateTo(accounts[1], accountAmount);
            await wflr.deposit({ from: accounts[1], value: accountAmount });  // mint wflr for contract
        });

        it("Should be able to vote with donated flares", async () => {
            const amount = toBN(5).mul(AMOUNT);
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, wflr.address, ftso.address);
            await flashLenderMock.donateTo(flashLoanMock.address, amount);
            await flashLoanMock.mintWflr(amount);
            // wflrs are minted (and block is advanced), so we can take this a vote power block
            const vpBlock = await web3.eth.getBlockNumber();
            // cashing will happen in a new block and won't affect block power
            await flashLoanMock.cashWflr(amount);
            // set vote power block
            await ftso.setVotePowerBlock(vpBlock, { from: accounts[10] });
            // start an epoch
            epochId = await startNewEpoch();
            // vote
            expectEvent(await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] }),
                "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId) });
            await flashLoanMock.submitPriceHash(380, 234);
            // reveal epoch
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            await increaseTimeTo((epochId + 1) * 120, 'web3'); // reveal period start
            // reveals
            expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), 
                "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
            await flashLoanMock.revealPrice(epochId, 380, 234);
            // finalize price
            await increaseTimeTo((epochId + 1) * 120 + 60, 'web3'); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), 
                "PriceFinalized", { epochId: toBN(epochId), price: toBN(380), finalizationType: toBN(1) });
        });
        
        it("Should not be able to vote with flash loaned flares (vote power block equals loan block)", async () => {
            const amount = toBN(5).mul(AMOUNT);
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, wflr.address, ftso.address);
            // request flash loan
            await flashLoanMock.testRequestLoan(amount);
            const loanBlock = await web3.eth.getBlockNumber();  // flash loan block
            // set vote power block
            await ftso.setVotePowerBlock(loanBlock, { from: accounts[10] });
            // test
            await tryVoting();
        });

        it("Should not be able to vote with flash loaned flares (vote power block just after loan)", async () => {
            const amount = toBN(5).mul(AMOUNT);
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, wflr.address, ftso.address);
            // request flash loan
            await flashLoanMock.testRequestLoan(amount);
            const loanBlock = await web3.eth.getBlockNumber();  // flash loan block
            // set vote power block
            await time.advanceBlock();  // to make loanBlock in the past of setVotePowerBlock
            await ftso.setVotePowerBlock(loanBlock + 1, { from: accounts[10] });
            // test
            await tryVoting();
        });

        async function tryVoting() {
            epochId = await startNewEpoch();
            // vote
            expectEvent(await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] }),
                "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId) });
            await flashLoanMock.submitPriceHash(380, 234);
            // reveal epoch
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            await increaseTimeTo((epochId + 1) * 120, 'web3'); // reveal period start
            // reveals
            expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }),
                "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
            await expectRevert(flashLoanMock.revealPrice(epochId, 380, 234),
                "Insufficient vote power to submit vote");
            // finalize price
            await increaseTimeTo((epochId + 1) * 120 + 60, 'web3'); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }),
                "PriceFinalized", { epochId: toBN(epochId), price: toBN(500), finalizationType: toBN(1) });
        }
        
        it("Is able to vote with flash loaned flares (reveal during loan), if votePowerBlock is in future (only manager can actually achive that)", async () => {
            const amount = toBN(5).mul(AMOUNT);
            votingFlashLoanMock = await VotingFlashLoanMock.new(flashLenderMock.address, wflr.address, ftso.address);
            // start epoch
            epochId = await startNewEpoch();
            // votes
            await votingFlashLoanMock.submitPriceHash(380, 234);
            await votingFlashLoanMock.setVote(epochId, 380, 234);
            expectEvent(await ftso.submitPriceHash(submitPriceHash(500, 123, accounts[1]), { from: accounts[1] }),
                "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId) });
            // reveal epoch
            // flash loan (and reveal) will happen in this block + x (x ~ 3), but we can set anything bigger as vote power block
            let lastBlock = await web3.eth.getBlockNumber();
            // would be able to vote with flash loan if votePowerBlock is in future, so it has to be prevented
            await expectRevert.unspecified(ftso.setVotePowerBlock(lastBlock + 1, { from: accounts[10] }));
            await expectRevert.unspecified(ftso.setVotePowerBlock(lastBlock + 100, { from: accounts[10] }));
            lastBlock = await web3.eth.getBlockNumber();
            await ftso.setVotePowerBlock(lastBlock, { from: accounts[10] });    // in the past - ok
            // start reveal
            await ftso.initializeCurrentEpochStateForReveal(false, { from: accounts[10] });
            await increaseTimeTo((epochId + 1) * 120, 'web3'); // reveal period start
            // take loan and vote
            await expectRevert(votingFlashLoanMock.testRequestLoan(amount),
                "Insufficient vote power to submit vote");
            expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }),
                "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
            // finalize price
            await increaseTimeTo((epochId + 1) * 120 + 60, 'web3'); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }),
                "PriceFinalized", { epochId: toBN(epochId), price: toBN(500), finalizationType: toBN(1) });
        });

    });
});
