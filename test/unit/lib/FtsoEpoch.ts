import { expect } from "chai";
import { contract } from "hardhat";
import { FtsoEpochMockContract, FtsoEpochMockInstance, MockContractContract, MockContractInstance, VPTokenContract } from "../../../typechain-truffle";
import { moveFromCurrentToNextEpochStart } from "../../utils/FTSO-test-utils";
import { increaseTimeTo, toBN } from "../../utils/test-helpers";

const getTestFile = require('../../utils/constants').getTestFile;
const FtsoEpoch = artifacts.require("FtsoEpochMock") as FtsoEpochMockContract;
const VpToken = artifacts.require("VPToken") as VPTokenContract;
const MockVpToken = artifacts.require("MockContract") as MockContractContract;
const {expectRevert} = require('@openzeppelin/test-helpers');


contract(`FtsoEpoch.sol; ${getTestFile(__filename)};  Ftso epoch unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoEpoch: FtsoEpochMockInstance
    let mockVpToken: MockContractInstance;
    let mockVpToken2: MockContractInstance;
    let mockVpToken3: MockContractInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        // uint256 firstEpochStartTime,
        // uint256 submitPeriod,
        // uint256 revealPeriod
        ftsoEpoch = await FtsoEpoch.new(5, 120, 60);
        mockVpToken = await MockVpToken.new();
        mockVpToken2 = await MockVpToken.new();
        mockVpToken3 = await MockVpToken.new();

        ftsoEpoch.setAssetNorm(mockVpToken.address, 3);
        ftsoEpoch.setAssetNorm(mockVpToken2.address, 3);
        ftsoEpoch.setAssetNorm(mockVpToken3.address, 3);

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
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [60000], [2]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.votePowerFlr).to.equals('40');
        expect(epoch.votePowerAsset).to.equals('120');
        expect(epoch.maxVotePowerFlr).to.equals('40');
        expect(epoch.maxVotePowerAsset).to.equals('60');
        expect(epoch.minVotePowerFlr).to.equals('0');
        expect(epoch.minVotePowerAsset).to.equals('0');
    });

    it(`Should add vote to epoch`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [60000], [2]);
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
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [60000], [2]);
        // _epochId, _voteId, _votePowerFlr, _votePowerAsset, _random, _price
        await ftsoEpoch._addVote(1, 10, 25, 20, 5, 50, {from: accounts[1]});
        let voterPrice = await ftsoEpoch.getEpochPriceForVoter(1, accounts[1]);
        expect(voterPrice.toString()).to.equals('50');
    });

    it(`Should sum vote power of voters correctly`, async () => {
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [60000], [2]);
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
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [60000], [2]);
        // _epochId, _voteId, _votePowerFlr, _votePowerAsset, _random, _price
        await ftsoEpoch._addVote(1, 10, 25, 20, 5, 50, {from: accounts[1]});
        await ftsoEpoch._initializeInstance(2, 30, [mockVpToken.address], [60000], [2]);
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
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [60000], [3]);
        await ftsoEpoch.configureEpochs(0, 20, 5, 2, 1, 1000, 10000, 50);
        await ftsoEpoch._initializeInstance(2, 60, [mockVpToken.address], [50000], [2]);

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
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [60000], [2]);
        await ftsoEpoch.setVotePowerBlock(3);
        await ftsoEpoch._initializeInstance(2, 60, [mockVpToken.address], [50000], [2]);

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.votePowerBlock).to.equals('1');

        const epoch2 = await ftsoEpoch.getEpochInstance(2);
        expect(epoch2.votePowerBlock).to.equals('3');
    });

    // it(`Should revert if votePowerFlr >= 2**128`, async () => {
    //     await expectRevert.assertion(ftsoEpoch._initializeInstance(1, toBN(2).pow(toBN(128)), [mockVpToken.address], [60], [2]));
    // });

    // it(`Should revert if assetVotePower >= 2**104`, async () => {
    //     await expectRevert.assertion(ftsoEpoch._initializeInstance(1, 60, [mockVpToken.address], [toBN(2).pow(toBN(104))], [1]));
    // });

    // it(`Should revert if assetPrice >= 2**128`, async () => {
    //     await expectRevert.assertion(ftsoEpoch._initializeInstance(1, 60, [mockVpToken.address], [1], [toBN(2).pow(toBN(128))]));
    // });

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
        await ftsoEpoch._initializeInstance(1, 40, [mockVpToken.address], [0], [3]);
        await ftsoEpoch._setWeightsParameters(1, 0, 0);
        weightRatio = await ftsoEpoch._getWeightRatio(1);
        expect(weightRatio.toNumber()).to.equals(0);
        
        //_assetVotePowerUSD < _state.lowAssetUSDThreshold
        await ftsoEpoch._initializeInstance(2, 40, [mockVpToken.address], [60000], [3]);
        await ftsoEpoch._setWeightsParameters(2, 0, 0);
        weightRatio = await ftsoEpoch._getWeightRatio(2);
        expect(weightRatio.toNumber()).to.equals(0);

        //turnout >= _state.highAssetTurnoutThreshold
        await ftsoEpoch._initializeInstance(3, 40, [mockVpToken.address], [500000], [3]);
        await ftsoEpoch._addVote(3, 1, 5, 600, 123, 20);
        await ftsoEpoch._setWeightsParameters(3, 125000000000, 400000000000);
        weightRatio = await ftsoEpoch._getWeightRatio(3);
        expect(weightRatio.toNumber()).to.equals(750);

        //turnout < _state.highAssetTurnoutThreshold
        await ftsoEpoch._initializeInstance(4, 40, [mockVpToken.address], [500000], [3]);
        await ftsoEpoch._addVote(4, 2, 5, 6, 123, 20);
        await ftsoEpoch._setWeightsParameters(4, 125000000000, 4000000000);
        weightRatio = await ftsoEpoch._getWeightRatio(4);
        expect(weightRatio.toNumber()).to.equals(600);

        //_assetVotePowerUSD >= _state.highAssetUSDThreshold)
        await ftsoEpoch._initializeInstance(5, 40, [mockVpToken.address], [50000000], [3]);
        await ftsoEpoch._addVote(5, 3, 5, 90000, 123, 20);
        await ftsoEpoch._setWeightsParameters(5, 125000000000, 600000000000);
        weightRatio = await ftsoEpoch._getWeightRatio(5);
        expect(weightRatio.toNumber()).to.equals(5000);
    });

    it("Should set assets correctly", async () => {
        await ftsoEpoch._setAssets(1, [mockVpToken.address, mockVpToken2.address, mockVpToken3.address], [2e6, 6e8, 3e7], [3, 5, 7]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.assets[0]).to.equals(mockVpToken.address);
        expect(epoch.assets[1]).to.equals(mockVpToken2.address);
        expect(epoch.assets[2]).to.equals(mockVpToken3.address);

        expect(epoch.assetWeightedPrices[0]).to.equals('55');
        expect(epoch.assetWeightedPrices[1]).to.equals('46641');
        expect(epoch.assetWeightedPrices[2]).to.equals('4570');

        expect(epoch.votePowerAsset).to.equals('2812181');
    });

    it("Should set assets correctly - zero prices", async () => {
        await ftsoEpoch._setAssets(1, [mockVpToken.address, mockVpToken2.address, mockVpToken3.address], [2e6, 6e8, 3e7], [0, 0, 0]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.assets[0]).to.equals(mockVpToken.address);
        expect(epoch.assets[1]).to.equals(mockVpToken2.address);
        expect(epoch.assets[2]).to.equals(mockVpToken3.address);

        expect(epoch.assetWeightedPrices[0]).to.equals('0');
        expect(epoch.assetWeightedPrices[1]).to.equals('0');
        expect(epoch.assetWeightedPrices[2]).to.equals('0');

        expect(epoch.votePowerAsset).to.equals('0');
    });

    it("Should compute weights correctly", async () => {
        let highAssetTurnoutThreshold = 9000;
        await ftsoEpoch.configureEpochs(0, 500, 1000, 1, 2, 1000, 10000, highAssetTurnoutThreshold);
        await ftsoEpoch._initializeInstance(1, 400, [mockVpToken.address], [700000], [11]);
        await ftsoEpoch._addVote(1, 5, 50, 400000, 123, 20);
        await ftsoEpoch._addVote(1, 6, 70, 200000, 321, 25);
        let weightFlr1 = Math.floor(50/400*1e12);//125.000.000.000
        let weightFlr2 = Math.floor(70/400*1e12);//175.000.000.000
        let weightFlrSum = weightFlr1 + weightFlr2;
        let assetVotePower = Math.floor(700000*11/1e3); // 7700
        let baseWeightRatio = Math.floor(4500*(assetVotePower-1000)/(10000-1000)) + 500;//3850;
        let assetVotePower1 = Math.floor(400000*11/1e3);
        let assetVotePower2 = Math.floor(200000*11/1e3);
        let weightAsset1 = Math.floor(assetVotePower1/assetVotePower*1e12);//571.428.571.428
        let weightAsset2 = Math.floor(assetVotePower2/assetVotePower*1e12);//285.714.285.714
        let weightAssetSum = weightAsset1 + weightAsset2;//857.142.857.142
        await ftsoEpoch._setWeightsParameters(1, weightFlrSum, weightAssetSum);
        const weights = await ftsoEpoch.computeWeights(1,[weightFlr1,weightFlr2], [weightAsset1,weightAsset2]);
        let turnout = Math.floor(weightAssetSum/100000000);
        let weightRatio = Math.floor(baseWeightRatio*turnout/highAssetTurnoutThreshold);

        let weightFlrShare = 10000-weightRatio;
        let weightAssetShare = weightRatio;

        let weight1 = Math.floor(weightFlrShare*weightFlr1/weightFlrSum*100000000)+
            Math.floor(weightAssetShare*weightAsset1/weightAssetSum*100000000);
        let weight2 = Math.floor(weightFlrShare*weightFlr2/weightFlrSum*100000000)+
            Math.floor(weightAssetShare*weightAsset2/weightAssetSum*100000000);

        expect(weights[0].toNumber()).to.equals(weight1);
        expect(weights[1].toNumber()).to.equals(weight2);

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.baseWeightRatio).to.equals(baseWeightRatio.toString());
        expect(epoch.weightRatio).to.equals(weightRatio.toString());
        expect(epoch.weightFlrSum).to.equals(weightFlrSum.toString());
        expect(epoch.weightAssetSum).to.equals(weightAssetSum.toString());
    });

    it("Should compute weights correctly - zero asset vote power sum", async () => {
        await ftsoEpoch._initializeInstance(1, 400, [mockVpToken.address], [700000], [11]);
        await ftsoEpoch._addVote(1, 5, 50, 0, 123, 20);
        await ftsoEpoch._addVote(1, 6, 70, 0, 321, 25);
        let weightFlr1 = Math.floor(50/400*1e12);
        let weightFlr2 = Math.floor(70/400*1e12);
        let weightFlrSum = weightFlr1 + weightFlr2;
        await ftsoEpoch._setWeightsParameters(1, weightFlrSum, 0);
        const weights = await ftsoEpoch.computeWeights(1,[weightFlr1,weightFlr2], [0,0]);

        expect(weights[0].toNumber()).to.equals(Math.floor(weightFlr1/weightFlrSum*1e12));
        expect(weights[1].toNumber()).to.equals(Math.floor(weightFlr2/weightFlrSum*1e12));

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.baseWeightRatio).to.equals('3850');
        expect(epoch.weightRatio).to.equals('0');
        expect(epoch.weightFlrSum).to.equals(weightFlrSum.toString());
        expect(epoch.weightAssetSum).to.equals('0');
    });

    it("Should compute weights correctly - zero flr vote power sum", async () => {
        await ftsoEpoch._initializeInstance(1, 400, [mockVpToken.address], [700000], [11]);
        await ftsoEpoch._addVote(1, 5, 0, 400000, 123, 20);
        await ftsoEpoch._addVote(1, 6, 0, 200000, 321, 25);

        let weightAsset1 = Math.floor(400000/700000*1e12*11/1e3);
        let weightAsset2 = Math.floor(200000/700000*1e12*11/1e3);
        let weightAssetSum = weightAsset1 + weightAsset2;
        await ftsoEpoch._setWeightsParameters(1, 0, weightAssetSum);
        const weights = await ftsoEpoch.computeWeights(1,[0,0], [weightAsset1,weightAsset2]);

        expect(weights[0].toNumber()).to.equals(Math.floor(weightAsset1/weightAssetSum*1e12));
        expect(weights[1].toNumber()).to.equals(Math.floor(weightAsset2/weightAssetSum*1e12));

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.baseWeightRatio).to.equals('3850');
        expect(epoch.weightRatio).to.equals('10000');
        expect(epoch.weightFlrSum).to.equals('0');
        expect(epoch.weightAssetSum).to.equals(weightAssetSum.toString());
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

