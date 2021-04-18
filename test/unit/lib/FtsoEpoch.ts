import { expect } from "chai";
import { contract } from "hardhat";
import { FtsoEpochMockContract, FtsoEpochMockInstance } from "../../../typechain-truffle";
import { moveFromCurrentToNextEpochStart } from "../../utils/FTSO-test-utils";
import { increaseTimeTo, toBN } from "../../utils/test-helpers";

const getTestFile = require('../../utils/constants').getTestFile;
const FtsoEpoch = artifacts.require("FtsoEpochMock") as FtsoEpochMockContract;
const {expectRevert} = require('@openzeppelin/test-helpers');

contract(`FtsoEpoch.sol; ${getTestFile(__filename)};  Ftso epoch unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoEpoch: FtsoEpochMockInstance

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        // uint256 firstEpochStartTime,
        // uint256 submitPeriod,
        // uint256 revealPeriod
        ftsoEpoch = await FtsoEpoch.new(5, 120, 60);
        await ftsoEpoch.setVotePowerBlock(1);

        // uint256 _minVoteCount,
        // uint256 _minVotePowerFlrThreshold,
        // uint256 _minVotePowerAssetThreshold,
        // uint256 _maxVotePowerFlrThreshold,
        // uint256 _maxVotePowerAssetThreshold,
        // uint256 _lowAssetUSDThreshold,
        // uint256 _highAssetUSDThreshold,
        // uint256 _highAssetTurnoutThreshold
        await ftsoEpoch.configureEpochs(0, 500, 1000, 1, 2, 1000, 10000, 50);
    });

    it(`Should create new epoch`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [60], [2]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.votePowerFlr).to.equals('40');
        expect(epoch.votePowerAsset).to.equals('120');
        expect(epoch.maxVotePowerFlr).to.equals('40');
        expect(epoch.maxVotePowerAsset).to.equals('60');
        expect(epoch.minVotePowerFlr).to.equals('0');
        expect(epoch.minVotePowerAsset).to.equals('0');
    });

    it(`Should add vote to epoch`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [60], [2]);
        // _epochId, _voteId, _votePowerFlr, _votePowerAsset, _random, _price
        await ftsoEpoch._addVote(1, 10, 25, 20, 5, 50, {from: accounts[1]});
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.firstVoteId).to.equals('10');
        expect(epoch.lastVoteId).to.equals('10');
        expect(epoch.voteCount).to.equals('1');
        expect(epoch.accumulatedVotePowerFlr).to.equals('25');
        expect(epoch.accumulatedVotePowerAsset).to.equals('20');
        expect(epoch.random).to.equals('5');
    });

    it(`Should set epoch price for voter correctly`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [60], [2]);
        // _epochId, _voteId, _votePowerFlr, _votePowerAsset, _random, _price
        await ftsoEpoch._addVote(1, 10, 25, 20, 5, 50, {from: accounts[1]});
        let voterPrice = await ftsoEpoch.getEpochPriceForVoter(1, accounts[1]);
        expect(voterPrice.toString()).to.equals('50');
    });

    it(`Should sum vote power of voters correctly`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [60], [2]);
        // _epochId, _voteId, _votePowerFlr, _votePowerAsset, _random, _price
        await ftsoEpoch._addVote(1, 10, 5, 20, 5, 50, {from: accounts[1]});
        await ftsoEpoch._addVote(1, 11, 15, 10, 15, 50, {from: accounts[2]});
        await ftsoEpoch._addVote(1, 12, 10, 0, 1000, 50, {from: accounts[3]});
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.firstVoteId).to.equals('10');
        expect(epoch.lastVoteId).to.equals('12');
        expect(epoch.voteCount).to.equals('3');
        expect(epoch.accumulatedVotePowerFlr).to.equals('30');
        expect(epoch.accumulatedVotePowerAsset).to.equals('30');
        expect(epoch.random).to.equals('1020');
    });

    it(`Should not change the epoch instance if vote is added to a new epoch instance`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [60], [2]);
        // _epochId, _voteId, _votePowerFlr, _votePowerAsset, _random, _price
        await ftsoEpoch._addVote(1, 10, 25, 20, 5, 50, {from: accounts[1]});
        await ftsoEpoch._initializeInstance(2, 30, [accounts[5]], [60], [2]);
        // _epochId, _voteId, _votePowerFlr, _votePowerAsset, _random, _price
        await ftsoEpoch._addVote(2, 12, 28, 18, 52, 80, {from: accounts[1]});

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.firstVoteId).to.equals('10');
        expect(epoch.lastVoteId).to.equals('10');
        expect(epoch.voteCount).to.equals('1');
        expect(epoch.accumulatedVotePowerFlr).to.equals('25');
        expect(epoch.accumulatedVotePowerAsset).to.equals('20');
        expect(epoch.random).to.equals('5');
    });

    it(`Should change state of a new epoch only`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [60], [3]);
        await ftsoEpoch.configureEpochs(0, 20, 5, 2, 1, 1000, 10000, 50);
        await ftsoEpoch._initializeInstance(2, 60, [accounts[5]], [50], [2]);

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.votePowerFlr).to.equals('40');
        expect(epoch.votePowerAsset).to.equals('180');
        expect(epoch.maxVotePowerFlr).to.equals('40');
        expect(epoch.maxVotePowerAsset).to.equals('90');
        expect(epoch.minVotePowerFlr).to.equals('0');
        expect(epoch.minVotePowerAsset).to.equals('0');

        const epoch2 = await ftsoEpoch.getEpochInstance(2);
        expect(epoch2.votePowerFlr).to.equals('60');
        expect(epoch2.votePowerAsset).to.equals('100');
        expect(epoch2.maxVotePowerFlr).to.equals('30');
        expect(epoch2.maxVotePowerAsset).to.equals('100');
        expect(epoch2.minVotePowerFlr).to.equals('3');
        expect(epoch2.minVotePowerAsset).to.equals('20');
    });

    it(`Should change vote power block of a new epoch only`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [60], [2]);
        await ftsoEpoch.setVotePowerBlock(3);
        await ftsoEpoch._initializeInstance(2, 60, [accounts[5]], [50], [2]);

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.votePowerBlock).to.equals('1');

        const epoch2 = await ftsoEpoch.getEpochInstance(2);
        expect(epoch2.votePowerBlock).to.equals('3');
    });

    // it(`Should revert if votePowerFlr >= 2**128`, async () => {
    //     await expectRevert.assertion(ftsoEpoch._initializeInstance(1, toBN(2).pow(toBN(128)), [accounts[5]], [60], [2]));
    // });

    it(`Should revert if assetVotePower >= 2**104`, async () => {
        await expectRevert.assertion(ftsoEpoch._initializeInstance(1, 60, [accounts[5]], [toBN(2).pow(toBN(104))], [1]));
    });

    it(`Should revert if assetPrice >= 2**128`, async () => {
        await expectRevert.assertion(ftsoEpoch._initializeInstance(1, 60, [accounts[5]], [1], [toBN(2).pow(toBN(128))]));
    });

    it(`Should calculate asset base weight ratio correctly`, async () => {
        // await ftsoEpoch.configureEpochs(0, 500, 1000, 1, 2, 1000, 10000, 50);
        let assetBaseWeightRatio;
        assetBaseWeightRatio = await ftsoEpoch._getAssetBaseWeightRatio(999);
        expect(assetBaseWeightRatio.toNumber()).to.equals(0);
        
        assetBaseWeightRatio = await ftsoEpoch._getAssetBaseWeightRatio(10000);
        expect(assetBaseWeightRatio.toNumber()).to.equals(5000);

        assetBaseWeightRatio = await ftsoEpoch._getAssetBaseWeightRatio(10001);
        expect(assetBaseWeightRatio.toNumber()).to.equals(5000);

        assetBaseWeightRatio = await ftsoEpoch._getAssetBaseWeightRatio(1000);
        expect(assetBaseWeightRatio.toNumber()).to.equals(500);

        assetBaseWeightRatio = await ftsoEpoch._getAssetBaseWeightRatio(1500);
        expect(assetBaseWeightRatio.toNumber()).to.equals(750);

        assetBaseWeightRatio = await ftsoEpoch._getAssetBaseWeightRatio(5500);
        expect(assetBaseWeightRatio.toNumber()).to.equals(2750);

        assetBaseWeightRatio = await ftsoEpoch._getAssetBaseWeightRatio(9500);
        expect(assetBaseWeightRatio.toNumber()).to.equals(4750);
    });

    it(`Should calculate weight ratio correctly`, async () => {
        // await ftsoEpoch.configureEpochs(0, 500, 1000, 1, 2, 1000, 10000, 50);
        let weightRatio;
        //_assetVotePowerUSD == 0
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [0], [3]);
        weightRatio = await ftsoEpoch._getWeightRatio(1);
        expect(weightRatio.toNumber()).to.equals(0);
        
        //_assetVotePowerUSD < _state.lowAssetUSDThreshold
        await ftsoEpoch._initializeInstance(2, 40, [accounts[5]], [60], [3]);
        weightRatio = await ftsoEpoch._getWeightRatio(2);
        expect(weightRatio.toNumber()).to.equals(0);

        //turnout >= _state.highAssetTurnoutThreshold
        await ftsoEpoch._initializeInstance(3, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(3, 1, 5, 600, 123, 20);
        weightRatio = await ftsoEpoch._getWeightRatio(3);
        expect(weightRatio.toNumber()).to.equals(750);

        //turnout < _state.highAssetTurnoutThreshold
        await ftsoEpoch._initializeInstance(4, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(4, 2, 5, 6, 123, 20);
        weightRatio = await ftsoEpoch._getWeightRatio(4);
        expect(weightRatio.toNumber()).to.equals(600);

        //_assetVotePowerUSD >= _state.highAssetUSDThreshold)
        await ftsoEpoch._initializeInstance(5, 40, [accounts[5]], [50000], [3]);
        await ftsoEpoch._addVote(5, 3, 5, 900, 123, 20);
        weightRatio = await ftsoEpoch._getWeightRatio(5);
        expect(weightRatio.toNumber()).to.equals(5000);
    });

    it("Should set assets correctly", async () => {
        await ftsoEpoch._setAssets(1, [accounts[5], accounts[6], accounts[7]], [2e3, 6e5, 3e4], [3, 5, 7]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.assets[0]).to.equals(accounts[5]);
        expect(epoch.assets[1]).to.equals(accounts[6]);
        expect(epoch.assets[2]).to.equals(accounts[7]);

        expect(epoch.assetWeightedPrices[0]).to.equals('54');
        expect(epoch.assetWeightedPrices[1]).to.equals('46640');
        expect(epoch.assetWeightedPrices[2]).to.equals('4564');

        expect(epoch.votePowerAsset).to.equals('2812102');
    });

    it("Should set assets correctly - zero vote powers", async () => {
        await ftsoEpoch._setAssets(1, [accounts[5], accounts[6], accounts[7]], [0, 0, 0], [3, 5, 7]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.assets[0]).to.equals(accounts[5]);
        expect(epoch.assets[1]).to.equals(accounts[6]);
        expect(epoch.assets[2]).to.equals(accounts[7]);

        expect(epoch.assetWeightedPrices[0]).to.equals('9999');
        expect(epoch.assetWeightedPrices[1]).to.equals('16665');
        expect(epoch.assetWeightedPrices[2]).to.equals('23331');

        expect(epoch.votePowerAsset).to.equals('0');
    });

    it("Should set assets correctly - zero prices", async () => {
        await ftsoEpoch._setAssets(1, [accounts[5], accounts[6], accounts[7]], [2e3, 6e5, 3e4], [0, 0, 0]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.assets[0]).to.equals(accounts[5]);
        expect(epoch.assets[1]).to.equals(accounts[6]);
        expect(epoch.assets[2]).to.equals(accounts[7]);

        expect(epoch.assetWeightedPrices[0]).to.equals('0');
        expect(epoch.assetWeightedPrices[1]).to.equals('0');
        expect(epoch.assetWeightedPrices[2]).to.equals('0');

        expect(epoch.votePowerAsset).to.equals('0');
    });

    it("Should compute weights correctly", async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(1, 5, 50, 400, 123, 20);
        await ftsoEpoch._addVote(1, 6, 70, 200, 321, 25);
        const data = await ftsoEpoch.computeWeights(1,[50,70], [400,200], 120, 600);
        const weights = data[0];
        expect(weights[0].toNumber()).to.equals(31350);
        expect(weights[1].toNumber()).to.equals(40650);
        expect(data[1].toNumber()).to.equals(750);
    });

    it("Should compute weights correctly - zero asset vote power sum", async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(1, 5, 50, 0, 123, 20);
        await ftsoEpoch._addVote(1, 6, 70, 0, 321, 25);
        const data = await ftsoEpoch.computeWeights(1,[50,70], [0,0], 120, 0);
        const weights = data[0];
        expect(weights[0].toNumber()).to.equals(50);
        expect(weights[1].toNumber()).to.equals(70);
        expect(data[1].toNumber()).to.equals(0);
    });

    it("Should compute weights correctly - zero flr vote power sum", async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(1, 5, 0, 400, 123, 20);
        await ftsoEpoch._addVote(1, 6, 0, 200, 321, 25);
        const data = await ftsoEpoch.computeWeights(1,[0,0], [400,200], 0, 600);
        const weights = data[0];
        expect(weights[0].toNumber()).to.equals(400);
        expect(weights[1].toNumber()).to.equals(200);
        expect(data[1].toNumber()).to.equals(0);
    });

    it("Should get weight correctly", async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(1, 5, 50, 400, 123, 20);
        await ftsoEpoch._addVote(1, 6, 70, 200, 321, 25);
        await ftsoEpoch.setWeightDataForEpoch(1, 120, 600, await ftsoEpoch._getWeightRatio(1));
        const weight1 = await ftsoEpoch._getWeight(1, 50, 400);
        const weight2 = await ftsoEpoch._getWeight(1, 70, 200);
        expect(weight1.toNumber()).to.equals(31350);
        expect(weight2.toNumber()).to.equals(40650);
    });

    it("Should get weights correctly - zero asset vote power sum", async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(1, 5, 50, 0, 123, 20);
        await ftsoEpoch._addVote(1, 6, 70, 0, 321, 25);
        await ftsoEpoch.setWeightDataForEpoch(1, 120, 0, await ftsoEpoch._getWeightRatio(1));
        const weight1 = await ftsoEpoch._getWeight(1, 50, 0);
        const weight2 = await ftsoEpoch._getWeight(1, 70, 0);
        expect(weight1.toNumber()).to.equals(50);
        expect(weight2.toNumber()).to.equals(70);
    });

    it("Should get weights correctly - zero flr vote power sum", async () => {
        await ftsoEpoch._initializeInstance(1, 40, [accounts[5]], [500], [3]);
        await ftsoEpoch._addVote(1, 5, 0, 400, 123, 20);
        await ftsoEpoch._addVote(1, 6, 0, 200, 321, 25);
        await ftsoEpoch.setWeightDataForEpoch(1, 0, 600, await ftsoEpoch._getWeightRatio(1));
        const weight1 = await ftsoEpoch._getWeight(1, 0, 400);
        const weight2 = await ftsoEpoch._getWeight(1, 0, 200);
        expect(weight1.toNumber()).to.equals(400);
        expect(weight2.toNumber()).to.equals(200);
    });

    it("Should return correct epochId", async () => {
        const epochId = await ftsoEpoch._getEpochId(124);
        expect(epochId.toNumber()).to.equals(0);
        const epochId1 = await ftsoEpoch._getEpochId(125);
        expect(epochId1.toNumber()).to.equals(1);
        const epochId2 = await ftsoEpoch._getEpochId(126);
        expect(epochId2.toNumber()).to.equals(1);
        const epochId3 = await ftsoEpoch._getEpochId(244);
        expect(epochId3.toNumber()).to.equals(1);
        const epochId4 = await ftsoEpoch._getEpochId(245);
        expect(epochId4.toNumber()).to.equals(2);
    });

    it("Should return correct epoch submit start time", async () => {
        const endTime = await ftsoEpoch._epochSubmitStartTime(0);
        expect(endTime.toNumber()).to.equals(5);
        const endTime1 = await ftsoEpoch._epochSubmitStartTime(1);
        expect(endTime1.toNumber()).to.equals(125);
        const endTime2 = await ftsoEpoch._epochSubmitStartTime(2);
        expect(endTime2.toNumber()).to.equals(245);
        const endTime3 = await ftsoEpoch._epochSubmitStartTime(10);
        expect(endTime3.toNumber()).to.equals(1205);
        const endTime4 = await ftsoEpoch._epochSubmitStartTime(500);
        expect(endTime4.toNumber()).to.equals(60005);
    });

    it("Should return correct epoch submit end time", async () => {
        const endTime = await ftsoEpoch._epochSubmitEndTime(0);
        expect(endTime.toNumber()).to.equals(125);
        const endTime1 = await ftsoEpoch._epochSubmitEndTime(1);
        expect(endTime1.toNumber()).to.equals(245);
        const endTime2 = await ftsoEpoch._epochSubmitEndTime(2);
        expect(endTime2.toNumber()).to.equals(365);
        const endTime3 = await ftsoEpoch._epochSubmitEndTime(10);
        expect(endTime3.toNumber()).to.equals(1325);
        const endTime4 = await ftsoEpoch._epochSubmitEndTime(500);
        expect(endTime4.toNumber()).to.equals(60125);
    });

    it("Should return correct epoch reveal end time", async () => {
        const endTime = await ftsoEpoch._epochRevealEndTime(0);
        expect(endTime.toNumber()).to.equals(185);
        const endTime1 = await ftsoEpoch._epochRevealEndTime(1);
        expect(endTime1.toNumber()).to.equals(305);
        const endTime2 = await ftsoEpoch._epochRevealEndTime(2);
        expect(endTime2.toNumber()).to.equals(425);
        const endTime3 = await ftsoEpoch._epochRevealEndTime(10);
        expect(endTime3.toNumber()).to.equals(1385);
        const endTime4 = await ftsoEpoch._epochRevealEndTime(500);
        expect(endTime4.toNumber()).to.equals(60185);
    });

    it("Should return epoch reveal in process correctly", async () => {
        const revealInProcess = await ftsoEpoch._epochRevealInProcess(10);
        expect(revealInProcess).to.equals(false);

        const epochId = await moveFromCurrentToNextEpochStart(5, 120, 1);
        const revealInProcess1 = await ftsoEpoch._epochRevealInProcess(epochId-1);
        expect(revealInProcess1).to.equals(true);
        const revealInProcess2 = await ftsoEpoch._epochRevealInProcess(epochId);
        expect(revealInProcess2).to.equals(false);

        increaseTimeTo(5 + epochId * 120 + 60);
        const revealInProcess3 = await ftsoEpoch._epochRevealInProcess(epochId-1);
        expect(revealInProcess3).to.equals(true);

        increaseTimeTo(5 + epochId * 120 + 61);
        const revealInProcess4 = await ftsoEpoch._epochRevealInProcess(epochId-1);
        expect(revealInProcess4).to.equals(false);

        increaseTimeTo(5 + (epochId+1) * 120);
        const revealInProcess5 = await ftsoEpoch._epochRevealInProcess(epochId);
        expect(revealInProcess5).to.equals(false);

        increaseTimeTo(5 + (epochId+1) * 120 + 1);
        const revealInProcess6 = await ftsoEpoch._epochRevealInProcess(epochId);
        expect(revealInProcess6).to.equals(true);
    });
});

