const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const RewardManager = artifacts.require("RewardManager");
const MockRewardManager = artifacts.require("MockContract");
const Inflation = artifacts.require("Inflation");

async function timeIncreaseTo (seconds) {
    const delay = 1000 - new Date().getMilliseconds();
    await new Promise(resolve => setTimeout(resolve, delay));
    await time.increaseTo(seconds);
}

contract(`Inflation.sol; ${getTestFile(__filename)}; Inflation unit tests`, async accounts => {
    // contains a fresh contract for each test
    let mockRewardManager;
    let rewardManagerInterface;
    let inflation;
    let startTs;

    beforeEach(async() => {
        mockRewardManager = await MockRewardManager.new();
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        inflation = await Inflation.new(
            accounts[0],
            86400,
            1000000
        );


        rewardManagerInterface = await RewardManager.new(
            accounts[0],
            inflation.address,
            172800,                      // Reward epoch 2 days
            120,                         // Price epoch 2 minutes
            startTs,
            startTs
        );
    });

    it("Should init annum inflation amount", async() => {
        // Assemble
        // Act
        const { totalInflationWei } = await inflation.flareAnnumData(0);
        // Assert
        assert.equal(totalInflationWei, 100000);
    });

    it("Should set reward contract daily reward amount for non-leap year", async() => {
        // Assemble
        // Assume blockchain start time is 1/1/2021 - not a leap year
        // 100000 / 365 = 273
        const setDailyRewardAmount = rewardManagerInterface.contract.methods.setDailyRewardAmount(273).encodeABI();
        // Act
        await inflation.setRewardContract(mockRewardManager.address);
        // Assert
        const invocationCount = await mockRewardManager.invocationCountForCalldata.call(setDailyRewardAmount);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should compute end of annum for non-leap year", async() => {
        // Assemble
        // Act
        let endTs = await inflation.currentAnnumEndsTs();
        // Assert
        // +365 days - 1 second less than start (no leap year)
        const { startTimeStamp } = await inflation.flareAnnumData(0);
        let endTsExpected = startTimeStamp.toNumber() + 365*86400 - 1;
        assert.equal(endTs.toNumber(), endTsExpected);
    });

    it("Should compute new annum after old annum ends and set new daily award amount", async() => {
        // Assemble
        // 110000 / 365 = 301
        const setDailyRewardAmount = rewardManagerInterface.contract.methods.setDailyRewardAmount(301).encodeABI();
        await inflation.setRewardContract(mockRewardManager.address);
        // time travel 1 year
        await time.increaseTo(startTs.addn(365*86400));
        // Act
        await inflation.keep();
        // Assert
        // Check annum inflation amount
        const { totalInflationWei } = await inflation.flareAnnumData(1);
        assert.equal(totalInflationWei.toNumber(), 110000);
        // Check new reward manager daily reward amount
        const invocationCount = await mockRewardManager.invocationCountForCalldata.call(setDailyRewardAmount);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should not compute a new annum", async() => {
        // Assemble
        // time travel 1 year - 1 second
        await time.increaseTo(startTs.addn(365*86400 - 1));
        // Act
        await inflation.keep();
        // Assert
        let currentAnnum = await inflation.currentFlareAnnum();
        assert.equal(currentAnnum.toNumber(), 0);
    });

    // TODO: Withdraw funds - check time lock
    // TODO: Withdraw funds - check time value sent to reward manager
    // TODO: Add withdraw funds to keeper?
});