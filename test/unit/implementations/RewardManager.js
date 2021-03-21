const {constants, expectRevert, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const RewardManager = artifacts.require("RewardManager");
const Inflation = artifacts.require("InflationMock");

async function timeIncreaseTo (seconds) {
    const delay = 1000 - new Date().getMilliseconds();
    await new Promise(resolve => setTimeout(resolve, delay));
    await time.increaseTo(seconds);
}

// TODO: OK, I tried really hard to write this in TS, BUT OZ helpers, which are very helpful to
// advance time and blocks, do not have TS bindings. See: 
// https://github.com/OpenZeppelin/openzeppelin-test-helpers/pull/141/checks?check_run_id=1415297312
// Back to Javascript...

contract(`RewardManager.sol; ${getTestFile(__filename)}; Reward manager unit tests`, async accounts => {
  // contains a fresh contract for each test
  let rewardManager;
  let inflation;
  let startTs;

  beforeEach(async() => {
    inflation = await Inflation.new(accounts[0]);

    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();
    console.log(`startTs: ${startTs}`);

    rewardManager = await RewardManager.new(
      accounts[0],
      inflation.address,
      172800000,                      // Reward epoch 2 days
      120000,                         // Price epoch 2 minutes
      startTs,
      startTs
    );
  });

  it("Should init price epoch start and not finalize", async() => {
    // Assemble
    await rewardManager.activate();
    // Act
    await rewardManager.keep();
    // Assert
    assert(startTs.eq(await rewardManager.firstPriceEpochStartTs()));
  });
});
