import { FtsoManagerContract, FtsoManagerInstance, FtsoManagerMockContract, FtsoManagerMockInstance, InflationMockContract, InflationMockInstance, MockContractInstance, RewardManagerContract, RewardManagerInstance, WFLRContract, WFLRInstance } from "../../../typechain-truffle";

const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const RewardManager = artifacts.require("RewardManager") as RewardManagerContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const Inflation = artifacts.require("InflationMock") as InflationMockContract;
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const WFLR = artifacts.require("WFLR") as WFLRContract;

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const ERR_GOVERNANCE_ONLY = "only governance"
const ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "gov. params not initialized"

contract(`RewardManager.sol; ${ getTestFile(__filename) }; Reward manager unit tests`, async accounts => {
    // contains a fresh contract for each test
    let rewardManager: RewardManagerInstance;
    let ftsoManagerInterface: FtsoManagerInstance;
    let inflation: InflationMockInstance;
    let startTs: BN;
    let mockFtsoManager: FtsoManagerMockInstance;
    let wFlr: WFLRInstance;

    beforeEach(async () => {
        inflation = await Inflation.new();
        mockFtsoManager = await MockFtsoManager.new();

        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        rewardManager = await RewardManager.new(
            accounts[0],
            inflation.address,
            // 172800,                      // Reward epoch 2 days
            // startTs
        );

        ftsoManagerInterface = await FtsoManager.new(
            accounts[0],
            rewardManager.address,
            accounts[7],
            PRICE_EPOCH_DURATION_S,
            startTs,
            REVEAL_EPOCH_DURATION_S,
            REWARD_EPOCH_DURATION_S,
            startTs,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        wFlr = await WFLR.new();

        await rewardManager.setFTSOManager(mockFtsoManager.address);
        await rewardManager.setWFLR(wFlr.address);
        await inflation.setRewardManager(rewardManager.address);
        await mockFtsoManager.setRewardManager(rewardManager.address);
        await rewardManager.activate();
    });

    describe("Price epochs, finalization", async () => {
        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
            await inflation.setRewardManagerDailyRewardAmount(1000000);

            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                PRICE_EPOCH_DURATION_S,
                0
            );

            // Assert
            // a1 should be (1000000 / (86400 / 120)) * 0.25 = 347
            // a2 should be = (1000000 / (86400 / 120)) * 0.75 = 1041
            // TODO: There is a remainder of 0.8 repeating. It is not being allocated. Ok?
            let a1UnclaimedReward = await rewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[1]);
            let a2UnclaimedReward = await rewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[2]);
            assert.equal(a1UnclaimedReward.toNumber(), 347);
            assert.equal(a2UnclaimedReward.toNumber(), 1041);
        });
    });

    describe("reward claiming", async () => {
        it("Should accept FLR", async () => {
            // Assemble
            // Act
            await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(rewardManager.address));
            assert.equal(balance.toNumber(), 1000000);
        });

        it("Should enable rewards to be claimed once reward epoch finalized", async () => {

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            let votePowerBlock = await web3.eth.getBlockNumber();
            
            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
            await inflation.setRewardManagerDailyRewardAmount(1000000);
            
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));
            // Trigger price epoch finalization
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                PRICE_EPOCH_DURATION_S,
                0
            );

            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            // Trigger reward epoch finalization and another finalization

            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                10,
                accounts[6],
                PRICE_EPOCH_DURATION_S,
                0
            );

            const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
            const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter( 'uint256', 1);
            await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
            
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await rewardManager.claimReward(accounts[3], [ 0 ], { from: accounts[1] });
            
            // Assert
            // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 * 2 finalizations = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), Math.floor(1000000 / (86400 / 120) * 0.25 * 2));
        });

    });

});
