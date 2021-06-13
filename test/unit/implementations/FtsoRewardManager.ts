import { compareArrays, compareNumberArrays, toBN } from "../../utils/test-helpers";
import { 
  FtsoManagerContract, 
  FtsoManagerInstance, 
  FtsoManagerMockContract, 
  FtsoManagerMockInstance, 
  FtsoRewardManagerContract, 
  FtsoRewardManagerInstance, 
  WFlrContract, 
  WFlrInstance, 
  InflationMockInstance, 
  MockContractInstance,
  SuicidalMockInstance} from "../../../typechain-truffle";

const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const WFLR = artifacts.require("WFlr") as WFlrContract;
const InflationMock = artifacts.require("InflationMock");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const ERR_CLOSE_MANAGER_ONLY = "close manager only";    

// contains a fresh contract for each test
let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let wFlr: WFlrInstance;
let mockInflation: InflationMockInstance;
let mockSupply: MockContractInstance;

async function distributeRewards(
  accounts: Truffle.Accounts, 
  startTs: BN, 
  currentRewardEpoch: number = 0, 
  sendFlrs: boolean = true
)
{
    let votePowerBlock = await web3.eth.getBlockNumber();
    // Assemble
    if (sendFlrs) {
        // give reward manager some flr to distribute...proxied through mock inflation
        await mockInflation.receiveInflation( {value: "1000000"} );
    }
    
    // Price epochs remaining is 720 (a days worth at 2 minute price epochs)

    // Trigger price epoch finalization
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        0,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + PRICE_EPOCH_DURATION_S - 1),
        votePowerBlock
    );

    await time.increaseTo((await time.latest()).addn(120));

    // Let's do another price epoch
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        1,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + (PRICE_EPOCH_DURATION_S * 2) - 1),
        votePowerBlock
    );

    const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(currentRewardEpoch).encodeABI();
    const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
    await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
}

async function travelToAndSetNewRewardEpoch(newRewardEpoch: number, startTs: BN) {
    // What reward epoch are we on based on current block time, given our startTs?
    const currentRewardEpoch = (await time.latest()).sub(startTs).div(toBN(REWARD_EPOCH_DURATION_S)).toNumber();
    for (let rewardEpoch = currentRewardEpoch; rewardEpoch < newRewardEpoch; rewardEpoch++) {
      // Time travel through each daily cycle as we work our way through to the next
      // reward epoch.
      for (let dailyCycle = 0; dailyCycle < (REWARD_EPOCH_DURATION_S / 86400); dailyCycle++) {
        try {
          await time.increaseTo(startTs.addn((rewardEpoch * REWARD_EPOCH_DURATION_S) + (dailyCycle * 86400)));
          await mockInflation.setDailyAuthorizedInflation(1000000);
        } catch (e) {
          if (e instanceof Error && e.message.includes("to a moment in the past")) {
            // Assume that if this is being done in the past, then it does not need to be done again.
            // So just skip.          
          } else {
            throw e;
          }
        }
      }
      // Travel to reach next reward epoch
      await time.increaseTo(startTs.addn((rewardEpoch + 1) * REWARD_EPOCH_DURATION_S));
      await mockInflation.setDailyAuthorizedInflation(1000000);
    }
    // Fake Trigger reward epoch finalization
    const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
    const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter( 'uint256', newRewardEpoch);
    await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
}

contract(`FtsoRewardManager.sol; ${ getTestFile(__filename) }; Ftso reward manager unit tests`, async accounts => {

    let fakeFlareKeeperAddress = accounts[0];
    let mockSuicidal: SuicidalMockInstance;

    beforeEach(async () => {
        mockFtsoManager = await MockFtsoManager.new();
        mockInflation = await InflationMock.new();
        mockSupply = await MockContract.new();

        ftsoRewardManager = await FtsoRewardManager.new(
            accounts[0],
            3,
            0,
            100,
            mockInflation.address,
            mockSupply.address
        );

        await mockInflation.setInflationReceiver(ftsoRewardManager.address);

        // set the daily authorized inflation...this proxies call to ftso reward manager
        await mockInflation.setDailyAuthorizedInflation(1000000);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoManagerInterface = await FtsoManager.new(
            accounts[0],
            accounts[0],
            ftsoRewardManager.address,
            accounts[7],
            PRICE_EPOCH_DURATION_S,
            startTs,
            REVEAL_EPOCH_DURATION_S,
            REWARD_EPOCH_DURATION_S,
            startTs,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        wFlr = await WFLR.new();

        await ftsoRewardManager.setFTSOManager(mockFtsoManager.address);
        await ftsoRewardManager.setWFLR(wFlr.address);
        mockSuicidal = await SuicidalMock.new(ftsoRewardManager.address);

        await mockFtsoManager.setRewardManager(ftsoRewardManager.address);

        await ftsoRewardManager.activate();
    });

    describe("basic", async () => {
        it("Should revert calling activate if ftso manger is not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                3,
                0,
                100,
                mockInflation.address,
                mockSupply.address
            );

            await expectRevert(ftsoRewardManager.activate(), "no ftso manager");
        });

        it("Should revert calling activate if wflr is not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                3,
                0,
                100,
                mockInflation.address,
                mockSupply.address
            );

            await ftsoRewardManager.setFTSOManager(mockFtsoManager.address);

            await expectRevert(ftsoRewardManager.activate(), "no wflr");
        });

        it("Should revert calling activate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.activate({ from: accounts[1]}), "only governance");
        });

        it("Should deactivate and disable claiming rewards", async () => {
            await ftsoRewardManager.deactivate();

            expectRevert(ftsoRewardManager.claimReward(accounts[2], [0]), "reward manager deactivated");
            expectRevert(ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]]), "reward manager deactivated");
        });

        it("Should revert calling deactivate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.deactivate({ from: accounts[1]}), "only governance");
        });
        
        it("Should update ftso manager", async () => {
            expect(await ftsoRewardManager.ftsoManager()).to.equals(mockFtsoManager.address);
            await ftsoRewardManager.setFTSOManager(accounts[8]);
            expect(await ftsoRewardManager.ftsoManager()).to.equals(accounts[8]);
        });

        it("Should revert calling setFtsoManager if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setFTSOManager(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setFtsoManager if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.setFTSOManager(constants.ZERO_ADDRESS), "no ftso manager");
        });

        it("Should update WFLR", async () => {
            expect(await ftsoRewardManager.wFlr()).to.equals(wFlr.address);
            await ftsoRewardManager.setWFLR(accounts[8]);
            expect(await ftsoRewardManager.wFlr()).to.equals(accounts[8]);
        });

        it("Should revert calling setWFLR if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setWFLR(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setWFLR if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.setWFLR(constants.ZERO_ADDRESS), "no wflr");
        });

        it("Should update inflation", async () => {
            expect(await ftsoRewardManager.inflation()).to.equals(mockInflation.address);
            await ftsoRewardManager.setInflation(accounts[8]);
            expect(await ftsoRewardManager.inflation()).to.equals(accounts[8]);
        });
        
        it("Should revert calling setInflation if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setInflation(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setInflation if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.setInflation(constants.ZERO_ADDRESS), "inflation zero");
        });

        it("Should update supply", async () => {
            expect(await ftsoRewardManager.supply()).to.equals(mockSupply.address);
            await ftsoRewardManager.setSupply(accounts[8]);
            expect(await ftsoRewardManager.supply()).to.equals(accounts[8]);
        });
        
        it("Should revert calling setSupply if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setSupply(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setSupply if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.setSupply(constants.ZERO_ADDRESS), "supply zero");
        });

        it("Should get epoch to expire next", async () => {
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(100, startTs);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(101, startTs);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(1);
        });
    });

    describe("Price epochs, finalization", async () => {
        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                PRICE_EPOCH_DURATION_S,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                0
            );

            // Assert
            // 2 minute price epochs yield 720 price epochs per day
            // 1000000 / 720 = 1388.8 repeating, rewards to award. Decimal will get truncated.
            // a1 should be (1000000 / 720) * 0.25 = 347.2 repeating
            // a2 should be = (1000000 / 720) * 0.75 = 1041.6 repeating
            // Price epoch awarding should be accumulated and used in double declining balance
            // allocation such that rounding at the end of a daily cycle is not an issue.
            // Not tested here, but decimal truncation for this particular test is valid.
            let a1UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[2]);
            assert.equal(a1UnclaimedReward[0].toNumber(), 347);
            assert.equal(a2UnclaimedReward[0].toNumber(), 1041);
        });

        it("Should finalize price epoch and distribute all authorized rewards for daily cycle", async () => {
            const dailyStartTs = await time.latest();

            // Time travel to the end of the daily cycle, distributing rewards along the way.
            // Make longer price epochs here so this test does not take as long to run.
            const MY_LONGER_PRICE_EPOCH_SEC = 3600;
            for(let i = 1; i <= (86400 / MY_LONGER_PRICE_EPOCH_SEC); i++) {
              await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                MY_LONGER_PRICE_EPOCH_SEC,
                0,
                startTs.addn(MY_LONGER_PRICE_EPOCH_SEC * i - 1),
                0
              );
              await time.increaseTo(dailyStartTs.addn(MY_LONGER_PRICE_EPOCH_SEC * i));
            }

            // Assert
            let a1UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[2]);
            assert.equal(a1UnclaimedReward[0].toNumber() + a2UnclaimedReward[0].toNumber(), 1000000);
        });

        it("Should only be called from ftso manager", async () => {
            await expectRevert(ftsoRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                REVEAL_EPOCH_DURATION_S,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                0
            ), "ftso manager only");
        });
    });

    describe("getters and setters", async () => {
        it("Should set and update data provider fee percentage", async () => {
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(1, startTs);
            await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);
            
            await travelToAndSetNewRewardEpoch(2, startTs);
            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[2] });
            await ftsoRewardManager.setDataProviderFeePercentage(15, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);
            
            await travelToAndSetNewRewardEpoch(3, startTs);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(5);
                        
            await travelToAndSetNewRewardEpoch(4, startTs);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(10);
                                    
            await travelToAndSetNewRewardEpoch(5, startTs);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(15);
        });

        it("Should get scheduled fee percentage", async () => {
            let data;
            
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);

            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5]);
            compareNumberArrays(data[1], [3]);
            compareArrays(data[2], [false]);

            await travelToAndSetNewRewardEpoch(1, startTs);
            expectEvent(await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[1] }),"FeePercentageChanged", 
                {dataProvider: accounts[1], value: toBN(10), validFromEpoch: toBN(4)});
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10]);
            compareNumberArrays(data[1], [3, 4]);
            compareArrays(data[2], [true, false]);
            
            await travelToAndSetNewRewardEpoch(2, startTs);
            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10, 8]);
            compareNumberArrays(data[1], [3, 4, 5]);
            compareArrays(data[2], [true, true, false]);
            await ftsoRewardManager.setDataProviderFeePercentage(15, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10, 15]);
            compareNumberArrays(data[1], [3, 4, 5]);
            compareArrays(data[2], [true, true, false]);
            
            await travelToAndSetNewRewardEpoch(3, startTs);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [10, 15]);
            compareNumberArrays(data[1], [4, 5]);
            compareArrays(data[2], [true, true]);

            await travelToAndSetNewRewardEpoch(4, startTs);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [15]);
            compareNumberArrays(data[1], [5]);
            compareArrays(data[2], [true]);

            await travelToAndSetNewRewardEpoch(5, startTs);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
        });

        it("Should revert if fee percentage > max bips", async () => {
            await expectRevert(ftsoRewardManager.setDataProviderFeePercentage(15000, { from: accounts[1] }), "invalid fee percentage value");
        });

        it("Should get state of rewards", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);
            
            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards - delegator only", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegate(accounts[1], 5000, { from: accounts[4] });
            
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[4], [0], { from: accounts[4]});

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards - delegator and provider - percentage", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[2], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegate(accounts[1], 5000, { from: accounts[2] });
            
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1]}), "RewardClaimed",
                {dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(347)});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            let tx = await ftsoRewardManager.claimReward(accounts[2], [0], { from: accounts[2]});
            expect(tx.logs[0].event).to.equals("RewardClaimed");
            expect(tx.logs[1].event).to.equals("RewardClaimed");            

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [true, true]);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [true, true]);
            expect(data[3]).to.equals(false);
        });

        it("Should revert at get state of rewards if delegated explicitly", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[2], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await expectRevert(ftsoRewardManager.getStateOfRewards(accounts[2], 0), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should get state of rewards - delegator and provider - explicit", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[2], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
            
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1]}), "RewardClaimed",
                {dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(347)});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]], { from: accounts[2]}), "RewardClaimed",
                {dataProvider: accounts[1], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(347)});

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[2]], { from: accounts[2]}), "RewardClaimed",
                {dataProvider: accounts[2], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(2082)});

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(false);
        });

        it("Should get state of rewards - no reward", async () => {
            let data;
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101, startTs);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards from data providers - no reward", async () => {
            let data;
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            await ftsoRewardManager.claimRewardFromDataProviders(accounts[1], [0], [accounts[1], accounts[2]], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101, startTs);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(false);
        });

    });

    describe("reward claiming", async () => {
        it("Should accept FLR", async () => {
            // Assemble
            // Act
            // Inflation must call ftso reward manager during funding, and this proxy does it.
            await mockInflation.receiveInflation({ value: "1000000" });
            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(ftsoRewardManager.address));
            assert.equal(balance.toNumber(), 1000000);
        });

        it("Should gracefully receive self-destruct proceeds", async() => {
          // Assemble
          // Give suicidal some FLR
          await web3.eth.sendTransaction({from: accounts[0], to: mockSuicidal.address, value: 1});
          // Sneak it into ftso reward manager
          await mockSuicidal.die();
          assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "1");
          // Act
          await mockInflation.receiveInflation({ value: "1" });
          // Assert
          assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "2");
          const selfDestructReceived = await ftsoRewardManager.totalSelfDestructReceivedWei();
          assert.equal(selfDestructReceived.toNumber(), 1);
        });

        it("Should gracefully receive self-destruct proceeds - initial balance > 0", async() => {
            // Add some initial balance (inflation)
            await mockInflation.receiveInflation({ value: "1" });
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "1");
            // Assemble
            // Give suicidal some FLR
            await web3.eth.sendTransaction({from: accounts[0], to: mockSuicidal.address, value: 1});
            // Sneak it into ftso reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "2");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "3");
            const selfDestructReceived = await ftsoRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructReceived.toNumber(), 1);
        });

        it("Should not accept FLR unless from inflation", async () => {
          // Assemble
          // Act
          const receivePromise = ftsoRewardManager.receiveInflation({ value: "1000000" });
          // Assert
          await expectRevert(receivePromise, "inflation only");
        });

        it("Should enable rewards to be claimed once reward epoch finalized - percentage", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - percentage", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - with self-destruct proceeds", async () => { 
          // deposit some wflrs
          await wFlr.deposit({ from: accounts[1], value: "100" });
          await wFlr.deposit({ from: accounts[4], value: "100" });

          // delegate some wflrs
          await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
          
          await distributeRewards(accounts, startTs);
          await travelToAndSetNewRewardEpoch(1, startTs);

          // Give suicidal some FLR
          await web3.eth.sendTransaction({from: accounts[0], to: mockSuicidal.address, value: 1});
          // Sneak it into ftso reward manager
          await mockSuicidal.die();
          
          // Act
          // Claim reward to a3 - test both 3rd party claim and avoid
          // having to calc gas fees            
          let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
          await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
          // Assert
          // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
          let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
          assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);
          let selfDestructProceeds = await ftsoRewardManager.totalSelfDestructReceivedWei();
          assert.equal(selfDestructProceeds.toNumber(), 1);

          // Create another suicidal
          const anotherMockSuicidal = await SuicidalMock.new(ftsoRewardManager.address);
          // Give suicidal some FLR
          await web3.eth.sendTransaction({from: accounts[0], to: anotherMockSuicidal.address, value: 1});
          // Sneak it into ftso reward manager
          await anotherMockSuicidal.die();
          
          // Act
          // Claim reward to a5 - test both 3rd party claim and avoid
          // having to calc gas fees            
          let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
          await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
          // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
          let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
          assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);
          selfDestructProceeds = await ftsoRewardManager.totalSelfDestructReceivedWei();
          assert.equal(selfDestructProceeds.toNumber(), 2);
        });
      


        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - should not claim twice", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            let flrClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance1.sub(flrOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let flrClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance3.sub(flrOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - get 0 if not rewarded ftso", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewards(accounts[4], 0, { from: accounts[4] });
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - percentage", async () => { 
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs);

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 7000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (7000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 0.95 (fee) = 2309
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 2309);
            
            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (7000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 1.05 (fee) + 1 (dust) = 2553
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 2553);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - percentage", async () => { 

            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs);

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "1000" });
            await wFlr.deposit({ from: accounts[4], value: "1" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 7000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (7000000 / 720) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 4
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 4);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (7000000 / 720) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) + 1 (dust) = 4858
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 4858);
        });

        it("Should enable rewards to be claimed once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);
        });

        it("Should revert at claiming rewards (not using claimRewardFromDataProviders) once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[2], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[2] });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            await expectRevert(ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[2] }), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - with self-destruct proceeds", async () => { 
          // Assemble
          // deposit some wflrs
          await wFlr.deposit({ from: accounts[4], value: "100" });

          // delegate some wflrs
          await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
          
          await distributeRewards(accounts, startTs);
          await travelToAndSetNewRewardEpoch(1, startTs);

          // Give suicidal some FLR
          await web3.eth.sendTransaction({from: accounts[0], to: mockSuicidal.address, value: 1});
          // Sneak it into ftso reward manager
          await mockSuicidal.die();

          // Act
          // Claim reward to a3 - test both 3rd party claim and avoid
          // having to calc gas fees            
          let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
          await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
          // Assert
          // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs = 694
          let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
          assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);
          const selfDestructProceeds = await ftsoRewardManager.totalSelfDestructReceivedWei();
          assert.equal(selfDestructProceeds.toNumber(), 1);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - should not claim twice", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            let flrClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance1.sub(flrOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance3.sub(flrOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - get 0 if not rewarded ftso", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[4], 0, [accounts[1]], { from: accounts[4] });
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - explicit", async () => { 
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs);

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid having to calc gas fees
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 7000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (7000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 0.95 (fee) = 2309
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 2309);
            
            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (7000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 1.05 (fee) + 1 (dust) = 2553
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 2553);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - explicit", async () => { 
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs);

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "1000" });
            await wFlr.deposit({ from: accounts[4], value: "1" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 1, { from: accounts[4] });
            
            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 7000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (7000000 / 720) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 4
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 4);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (7000000 / 720) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) + 1 (dust) = 4858
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 4858);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized", async () => {
            await wFlr.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);
            await distributeRewards(accounts, startTs, 1, false);
            await travelToAndSetNewRewardEpoch(2, startTs);
            await distributeRewards(accounts, startTs, 2, false);

            // can claim Math.floor(1000000 / 720) + Math.floor((1000000 - 1388) / 719) = 2776
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0, 1, 2, 3], { from: accounts[1] });

            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 2776);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized - explicit", async () => {
            await wFlr.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs);
            await distributeRewards(accounts, startTs, 1, false);
            await travelToAndSetNewRewardEpoch(2, startTs);
            await distributeRewards(accounts, startTs, 2, false);

            // can claim Math.floor(1000000 / 720) + Math.floor((1000000 - 1388) / 719) = 2776
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0, 1, 2, 3], [accounts[1], accounts[2]], { from: accounts[1] });

            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 2776);
        });
    });

    describe("close expired reward epochs", async () => {
        it("Should update expired rewards", async () => {
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);

            await travelToAndSetNewRewardEpoch(1, startTs);
            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            await travelToAndSetNewRewardEpoch(100, startTs);
            await mockFtsoManager.closeExpiredRewardEpochsCall();
            let rewardExpired = await ftsoRewardManager.totalExpiredWei();
            assert.equal(rewardExpired.toNumber(), 0);

            await travelToAndSetNewRewardEpoch(101, startTs);
            await mockFtsoManager.closeExpiredRewardEpochsCall();
            rewardExpired = await ftsoRewardManager.totalExpiredWei();
            assert.equal(rewardExpired.toNumber(), 2082);
        });

        it("Should only be called from ftso manager", async () => {
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpochs(), "ftso manager only");
        });
    });
});
