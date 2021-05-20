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
        await ftsoVote.createInstance(1, 2, 3, 4, 20); // returns transaction, not voteId
        const voteId = await ftsoVote.getLastVoteId();
        expect(voteId.toNumber()).to.equals(1);
    });

    it(`Last vote should be created vote`, async () => {
        await ftsoVote.createInstance(1, 2, 3, 4, 20); // returns transaction, not voteId
        const voteId = await ftsoVote.getLastVoteId();
        let vote = await ftsoVote.getVote(voteId);
        let vote2 = await ftsoVote.getLastVote();
        expect(vote).to.deep.equals(vote2);
    });

    it(`Should set vote price correctly`, async () => {
        await ftsoVote.createInstance(1, 2, 3, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.price).to.equals('20');
    });

    it(`Should set vote weight FLR correctly`, async () => {
        await ftsoVote.createInstance(1, 2, 3, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.weightFlr).to.equals('333333333333');
    });

    it(`Should set vote weight asset correctly`, async () => {
        await ftsoVote.createInstance(1, 2, 3, 4, 20); // returns transaction, not voteId
        let vote = await ftsoVote.getLastVote();
        expect(vote.weightAsset).to.equals('500000000000');
    });
    
    it(`Should create two votes`, async () => {
        await ftsoVote.createInstance(1, 2, 3, 4, 20); // returns transaction, not voteId
        await ftsoVote.createInstance(1, 2, 3, 4, 20); // returns transaction, not voteId
        const voteId = await ftsoVote.getLastVoteId();
        expect(voteId.toNumber()).to.equals(2);
    });
});

