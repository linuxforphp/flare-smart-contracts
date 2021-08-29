import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import {
    InflationMockInstance, MockContractInstance, SuicidalMockInstance, DataAvailabilityRewardManagerInstance
} from "../../../../typechain-truffle";
import { toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;

const DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");
const InflationMock = artifacts.require("InflationMock");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");

const REWARD_EPOCH_DURATION_S = 7 * 24 * 60 * 60; // 7 days

// contains a fresh contract for each test
let dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance;
let startTs: BN;
let mockInflation: InflationMockInstance;
let mockStateConnector: MockContractInstance;

async function mockTotalDataAvailabilityPeriodsMined(rewardEpochs: number[], totalDataAvailabilityPeriodsMined: number[])
{
    const len = rewardEpochs.length;
    assert(len == totalDataAvailabilityPeriodsMined.length, "Lengths must match");

    await mockInflation.receiveInflation( {value: "100000000"} );

    for (let i = 0; i < len; i++) {
        const getTotalDataAvailabilityPeriodsMined = web3.eth.abi.encodeFunctionCall({type: "function", name: "getTotalDataAvailabilityPeriodsMined", inputs: [{type: "uint256", name: "rewardSchedule"}]} as AbiItem, [rewardEpochs[i].toString()]);
        const getTotalDataAvailabilityPeriodsMinedReturn = web3.eth.abi.encodeParameter( 'uint256', totalDataAvailabilityPeriodsMined[i]);
        await mockStateConnector.givenCalldataReturn(getTotalDataAvailabilityPeriodsMined, getTotalDataAvailabilityPeriodsMinedReturn);
    }
}

async function mockDataAvailabilityPeriodsMined(rewardEpochs: number[], dataAvailabilityPeriodsMined: number[], validatorAddress: string)
{
    const len = rewardEpochs.length;
    assert(len == dataAvailabilityPeriodsMined.length, "Lengths must match");

    for (let i = 0; i < len; i++) {
        const getDataAvailabilityPeriodsMined = web3.eth.abi.encodeFunctionCall({type: "function", name: "getDataAvailabilityPeriodsMined", inputs: [{type: "address", name: "miner"}, {type: "uint256", name: "rewardSchedule"}]} as AbiItem, [validatorAddress, rewardEpochs[i].toString()]);
        const getDataAvailabilityPeriodsMinedReturn = web3.eth.abi.encodeParameter( 'uint256', dataAvailabilityPeriodsMined[i]);
        await mockStateConnector.givenCalldataReturn(getDataAvailabilityPeriodsMined, getDataAvailabilityPeriodsMinedReturn);
    }
}

async function travelToAndSetNewRewardEpoch(newRewardEpoch: number, startTs: BN) {
    const getCurrentRewardEpoch = web3.utils.sha3("getRewardPeriod()")!.slice(0,10); // first 4 bytes is function selector

    // What reward epoch are we on based on current block time, given our startTs?
    const currentRewardEpoch = (await time.latest()).sub(startTs).div(toBN(REWARD_EPOCH_DURATION_S)).toNumber();
    for (let rewardEpoch = currentRewardEpoch; rewardEpoch < newRewardEpoch; rewardEpoch++) {

        // Fake Trigger reward epoch finalization
        let getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter( 'uint256', rewardEpoch);
        await mockStateConnector.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);

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
    }

    let getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter( 'uint256', newRewardEpoch);
    await mockStateConnector.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
    
    // Travel to reach next reward epoch
    await time.increaseTo(startTs.addn((newRewardEpoch) * REWARD_EPOCH_DURATION_S));
    await mockInflation.setDailyAuthorizedInflation(1000000);
}

contract(`DataAvailabilityRewardManager.sol; ${ getTestFile(__filename) }; Data availability reward manager unit tests`, async accounts => {

    let mockSuicidal: SuicidalMockInstance;

    beforeEach(async () => {
        mockInflation = await InflationMock.new();
        mockStateConnector = await MockContract.new();
        
        dataAvailabilityRewardManager = await DataAvailabilityRewardManager.new(
            accounts[0],
            10,
            mockStateConnector.address,
            mockInflation.address
        );
            
        await mockInflation.setInflationReceiver(dataAvailabilityRewardManager.address);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        mockSuicidal = await SuicidalMock.new(dataAvailabilityRewardManager.address);

        await dataAvailabilityRewardManager.activate();
    });

    describe("basic", async () => {
        it("Should revert calling activate if not from governance", async () => {
            await expectRevert(dataAvailabilityRewardManager.activate({ from: accounts[1]}), "only governance");
        });

        it("Should deactivate and disable claiming rewards", async () => {
            await dataAvailabilityRewardManager.deactivate();

            await expectRevert(dataAvailabilityRewardManager.claimReward(accounts[2], [0]), "reward manager deactivated");
        });

        it("Should revert calling deactivate if not from governance", async () => {
            await expectRevert(dataAvailabilityRewardManager.deactivate({ from: accounts[1]}), "only governance");
        });
        
        it("Should update state connector", async () => {
            expect(await dataAvailabilityRewardManager.stateConnector()).to.equals(mockStateConnector.address);
            await dataAvailabilityRewardManager.setStateConnector(accounts[8]);
            expect(await dataAvailabilityRewardManager.stateConnector()).to.equals(accounts[8]);
        });

        it("Should revert calling setStateConnector if not from governance", async () => {
            await expectRevert(dataAvailabilityRewardManager.setStateConnector(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setStateConnector if setting to address(0)", async () => {
            await expectRevert(dataAvailabilityRewardManager.setStateConnector(constants.ZERO_ADDRESS), "no state connector");
        });

        it("Should update inflation", async () => {
            expect(await dataAvailabilityRewardManager.inflation()).to.equals(mockInflation.address);
            await dataAvailabilityRewardManager.setInflation(accounts[8]);
            expect(await dataAvailabilityRewardManager.inflation()).to.equals(accounts[8]);
        });
        
        it("Should revert calling setInflation if not from governance", async () => {
            await expectRevert(dataAvailabilityRewardManager.setInflation(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setInflation if setting to address(0)", async () => {
            await expectRevert(dataAvailabilityRewardManager.setInflation(constants.ZERO_ADDRESS), "inflation zero");
        });

        it("Should get epoch to expire next", async () => {
            expect((await dataAvailabilityRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(10, startTs);
            expect((await dataAvailabilityRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(11, startTs);
            expect((await dataAvailabilityRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(1);
        });
    });

    describe("Reward epochs, finalization", async () => {
        it("Should finalize reward epoch and set total authorized inflation as reward unclaimed value", async () => {

            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Assert
            // 1000000 authorized inflation per day
            // 7 * 1000000 = 7000000
            let rewardEpoch = await dataAvailabilityRewardManager.getEpochReward(0);
            assert.equal(rewardEpoch[0].toNumber(), 7000000);
            assert.equal(rewardEpoch[1].toNumber(), 0);
        });

        it("Should finalize reward epochs and distribute all authorized inflation to reward epochs", async () => {

            await mockTotalDataAvailabilityPeriodsMined([0, 1, 2], [55, 0, 20]);
            await travelToAndSetNewRewardEpoch(3, startTs);

            // Assert
            assert.equal((await dataAvailabilityRewardManager.getEpochReward(0))[0].toNumber(), 7000000);
            assert.equal((await dataAvailabilityRewardManager.getEpochReward(1))[0].toNumber(), 0);
            assert.equal((await dataAvailabilityRewardManager.getEpochReward(2))[0].toNumber(), 14000000);
        });

        it("Should finalize reward epochs and distribute all authorized inflation to reward epochs - inflation authorized not called from beginning", async () => {

            await mockTotalDataAvailabilityPeriodsMined([0, 1, 2, 3], [55, 5, 20, 34]);

            // skip first 3 reward epochs - no inflation authorized calls
            await time.increaseTo(startTs.addn(22 * 86400));

            await travelToAndSetNewRewardEpoch(4, startTs);

            // Assert
            assert.equal((await dataAvailabilityRewardManager.getEpochReward(0))[0].toNumber(), 333333);
            assert.equal((await dataAvailabilityRewardManager.getEpochReward(1))[0].toNumber(), 333333);
            assert.equal((await dataAvailabilityRewardManager.getEpochReward(2))[0].toNumber(), 333334);
            assert.equal((await dataAvailabilityRewardManager.getEpochReward(3))[0].toNumber(), 5000000);
        });
    });

    describe("getters and setters", async () => {
        it("Should get token pool supply data", async () => {
            let data = await dataAvailabilityRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(0);
            expect(data[2].toNumber()).to.equals(0);

            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await travelToAndSetNewRewardEpoch(1, startTs);

            await mockDataAvailabilityPeriodsMined([0], [15], accounts[1]);
            await dataAvailabilityRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});

            data = await dataAvailabilityRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(7000000);
            expect(data[2].toNumber()).to.equals(1909090); // 7 * 1000000 * 15 / 55
        });

        it("Should get state of rewards", async () => {
            let data;
            
            await expectRevert(dataAvailabilityRewardManager.getStateOfRewards(accounts[1], 0), "unknown reward epoch");
            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await mockDataAvailabilityPeriodsMined([0], [11], accounts[1]);

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await dataAvailabilityRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].toNumber()).to.equals(1400000); // 7 * 1000000 * 11 / 55
            expect(data[1]).to.equals(false);
            expect(data[2]).to.equals(true);
            
            await dataAvailabilityRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await dataAvailabilityRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].toNumber()).to.equals(1400000);
            expect(data[1]).to.equals(true);
            expect(data[2]).to.equals(true);

            await travelToAndSetNewRewardEpoch(11, startTs);
            data = await dataAvailabilityRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].toNumber()).to.equals(1400000);
            expect(data[1]).to.equals(true);
            expect(data[2]).to.equals(false);
        });

        it("Should get state of rewards - no reward", async () => {
            let data;

            await travelToAndSetNewRewardEpoch(1, startTs);
            data = await dataAvailabilityRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1]).to.equals(false);
            expect(data[2]).to.equals(true);

            await dataAvailabilityRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await dataAvailabilityRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1]).to.equals(true);
            expect(data[2]).to.equals(true);

            await travelToAndSetNewRewardEpoch(11, startTs);
            data = await dataAvailabilityRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1]).to.equals(true);
            expect(data[2]).to.equals(false);
        });
    });

    describe("reward claiming", async () => {
        it("Should accept native token", async () => {
            // Assemble
            // Act
            // Inflation must call ftso reward manager during funding, and this proxy does it.
            await mockInflation.receiveInflation({ value: "1000000" });
            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(dataAvailabilityRewardManager.address));
            assert.equal(balance.toNumber(), 1000000);
        });

        it("Should gracefully receive self-destruct proceeds", async() => {
          // Assemble
          // Give suicidal some native token
          await web3.eth.sendTransaction({from: accounts[0], to: mockSuicidal.address, value: 1});
          // Sneak it into ftso reward manager
          await mockSuicidal.die();
          assert.equal(await web3.eth.getBalance(dataAvailabilityRewardManager.address), "1");
          // Act
          await mockInflation.receiveInflation({ value: "1" });
          // Assert
          assert.equal(await web3.eth.getBalance(dataAvailabilityRewardManager.address), "2");
          const selfDestructReceived = await dataAvailabilityRewardManager.totalSelfDestructReceivedWei();
          assert.equal(selfDestructReceived.toNumber(), 1);
        });

        it("Should gracefully receive self-destruct proceeds - initial balance > 0", async() => {
            // Add some initial balance (inflation)
            await mockInflation.receiveInflation({ value: "1" });
            assert.equal(await web3.eth.getBalance(dataAvailabilityRewardManager.address), "1");
            // Assemble
            // Give suicidal some native token
            await web3.eth.sendTransaction({from: accounts[0], to: mockSuicidal.address, value: 1});
            // Sneak it into ftso reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(dataAvailabilityRewardManager.address), "2");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            assert.equal(await web3.eth.getBalance(dataAvailabilityRewardManager.address), "3");
            const selfDestructReceived = await dataAvailabilityRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructReceived.toNumber(), 1);
        });

        it("Should not accept native token unless from inflation", async () => {
          // Assemble
          // Act
          const receivePromise = dataAvailabilityRewardManager.receiveInflation({ value: "1000000" });
          // Assert
          await expectRevert(receivePromise, "inflation only");
        });

        it("Should enable rewards to be claimed once reward epoch finalized", async () => { 

            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await mockDataAvailabilityPeriodsMined([0], [15], accounts[1]);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await dataAvailabilityRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be 7 days * 1000000 * 15 / 55 = 1909090
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1909090);
        });

        it("Should enable rewards to be claimed once reward epoch finalized - with self-destruct proceeds", async () => { 
          
            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await mockDataAvailabilityPeriodsMined([0], [15], accounts[1]);
            await mockDataAvailabilityPeriodsMined([0], [15], accounts[2]);
            await mockDataAvailabilityPeriodsMined([0], [25], accounts[3]);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Give suicidal some native token
            await web3.eth.sendTransaction({from: accounts[0], to: mockSuicidal.address, value: 1});
            // Sneak it into ftso reward manager
            await mockSuicidal.die();
            
            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await dataAvailabilityRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (7 * 1000000) * 15 / 55 = 1909090
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1909090);
            let selfDestructProceeds = await dataAvailabilityRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructProceeds.toNumber(), 1);

            // Create another suicidal
            const anotherMockSuicidal = await SuicidalMock.new(dataAvailabilityRewardManager.address);
            // Give suicidal some native token
            await web3.eth.sendTransaction({from: accounts[0], to: anotherMockSuicidal.address, value: 1});
            // Sneak it into ftso reward manager
            await anotherMockSuicidal.die();

            // Act
            // Claim reward to a4 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[4]));
            await dataAvailabilityRewardManager.claimReward(accounts[4], [0], { from: accounts[2] });
            // a1 -> a3 claimed should be (7 * 1000000 - 1909090) * 15 / 40 = 1909091
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[4]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 1909091);
            
            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await dataAvailabilityRewardManager.claimReward(accounts[5], [0], { from: accounts[3] });
            // a2 -> a5 claimed should be (7 * 1000000) - 1909090 - 1909091 = 3181819
            let natClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance3.sub(natOpeningBalance3).toNumber(), 3181819);
            selfDestructProceeds = await dataAvailabilityRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructProceeds.toNumber(), 2);
        });

        it("Should enable rewards to be claimed once reward epoch finalized - should not claim twice", async () => { 

            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await mockDataAvailabilityPeriodsMined([0], [15], accounts[1]);
            await travelToAndSetNewRewardEpoch(1, startTs);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await dataAvailabilityRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a4 -> a3 claimed should be (7 * 1000000) * 15 / 55 = 1909090
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1909090);

            // if claiming again, get 0
            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await dataAvailabilityRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance1.sub(natOpeningBalance1).toNumber(), 0);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized", async () => {

            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await mockDataAvailabilityPeriodsMined([0], [15], accounts[1]);
            await travelToAndSetNewRewardEpoch(1, startTs);
            await mockTotalDataAvailabilityPeriodsMined([1], [50]);
            await mockDataAvailabilityPeriodsMined([1], [12], accounts[1]);
            await travelToAndSetNewRewardEpoch(2, startTs);
            await mockTotalDataAvailabilityPeriodsMined([2], [25]);
            await mockDataAvailabilityPeriodsMined([2], [17], accounts[1]);
            await travelToAndSetNewRewardEpoch(3, startTs);

            // can claim Math.floor(7 * 1000000 * 15 / 55) + Math.floor(7 * 1000000 * 12 / 50) + Math.floor(7 * 1000000 * 17 / 25) = 1909090 + 1680000 + 4760000 = 8349090
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await dataAvailabilityRewardManager.claimReward(accounts[3], [0, 1, 2, 3, 4], { from: accounts[1] });

            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 8349090);
        });
    });

    describe("close expired reward epochs", async () => {
        it("Should update expired rewards", async () => {

            await mockTotalDataAvailabilityPeriodsMined([0], [55]);
            await mockDataAvailabilityPeriodsMined([0], [15], accounts[1]);

            await travelToAndSetNewRewardEpoch(1, startTs);
            await dataAvailabilityRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            await travelToAndSetNewRewardEpoch(10, startTs);
            let rewardExpired = await dataAvailabilityRewardManager.totalExpiredWei();
            assert.equal(rewardExpired.toNumber(), 0);

            await travelToAndSetNewRewardEpoch(11, startTs);
            rewardExpired = await dataAvailabilityRewardManager.totalExpiredWei();
            assert.equal(rewardExpired.toNumber(), 5090910); // (7 * 1000000) - 1909090 = 5090910
        });

    });
});
