import { expect } from "chai";
import { artifacts, contract } from "hardhat";
import { FtsoVoteMockContract, FtsoVoteMockInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";

const getTestFile = require('../../utils/constants').getTestFile;
const FtsoVote = artifacts.require("FtsoVoteMock") as FtsoVoteMockContract;

contract(`FtsoVote.sol; ${getTestFile(__filename)};  Ftso vote unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoVote: FtsoVoteMockInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        ftsoVote = await FtsoVote.new();
    });

    it(`Should create new vote`, async () => {
        await ftsoVote._createInstance(1, 2, 10, 10, 3, 4, 20); // returns transaction, not voteId
        const voteId = await ftsoVote.getLastVoteId();
        expect(voteId.toNumber()).to.equals(0);
    });

    it(`Last vote should be created vote`, async () => {
        await ftsoVote._createInstance(1, 2, 10, 10, 3, 4, 20); // returns transaction, not voteId
        const voteId = await ftsoVote.getLastVoteId();
        let vote = await ftsoVote.getVote(voteId);
        let vote2 = await ftsoVote.getLastVote();
        expect(vote).to.deep.equals(vote2);
    });

    it(`Should set vote price correctly`, async () => {
        await ftsoVote._createInstance(1, 2, 10, 10, 3, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.price).to.equals('20');
    });

    it(`Should set vote weight FLR correctly`, async () => {
        await ftsoVote._createInstance(1, 2, 10, 10, 3, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.weightFlr).to.equals('1');
    });

    it(`Should set vote weight asset correctly`, async () => {
        await ftsoVote._createInstance(1, 2, 10, 10, 3, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.weightAsset).to.equals('2');
    });

    it(`Should set vote weight FLR correctly (maxVotePower >= 2**64)`, async () => {
        await ftsoVote._createInstance(1, 2, toBN(2).pow(toBN(64)), 10, 2, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.weightFlr).to.equals(toBN(2).pow(toBN(63)).sub(toBN(1)).toString());
    });

    it(`Should set vote weight asset correctly (maxVotePower >= 2**64)`, async () => {
        await ftsoVote._createInstance(1, 2, 10, toBN(2).pow(toBN(64)), 3, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.weightAsset).to.equals(toBN(2).pow(toBN(63)).sub(toBN(1)).toString());
    });
    
    it(`Should create two votes`, async () => {
        await ftsoVote._createInstance(1, 2, 10, 10, 3, 4, 20); // returns transaction, not voteId
        await ftsoVote._createInstance(1, 2, 10, 10, 3, 4, 20); // returns transaction, not voteId
        const voteId = await ftsoVote.getLastVoteId();
        expect(voteId.toNumber()).to.equals(1);
    });
});

