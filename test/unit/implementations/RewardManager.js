const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const RewardManager = artifacts.require("RewardManager");
const Inflation = artifacts.require("InflationMock");
const FTSO = artifacts.require("FtsoMock");

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

    rewardManager = await RewardManager.new(
      accounts[0],
      inflation.address,
      172800,                      // Reward epoch 2 days
      120,                         // Price epoch 2 minutes
      startTs,
      startTs
    );
  });

  it("Should init price epoch start and not finalize anything", async() => {
    // Assemble
    await rewardManager.activate();
    // Act
    let tx = await rewardManager.keep();
    // Assert
    assert(startTs.eq(await rewardManager.firstPriceEpochStartTs()));
    expectEvent.notEmitted(tx, "PriceEpochFinalized");
    expectEvent.notEmitted(tx, "RewardEpochFinalized");
  });

  it("Should finalize a price epoch only", async() => {
    // Assemble
    await rewardManager.activate();
    // Time travel 120 seconds
    await time.increaseTo(startTs.addn(120));
    // Act
    let tx = await rewardManager.keep();
    // Assert
    expectEvent(tx, "PriceEpochFinalized");
    expectEvent.notEmitted(tx, "RewardEpochFinalized");
  });

  it("Should finalize a price epoch at the configured interval", async() => {
    // Assemble
    await rewardManager.activate();
    // Time travel 120 seconds
    await time.increaseTo(startTs.addn(120));
    await rewardManager.keep();
    // Time travel another 120 seconds
    await time.increaseTo(startTs.addn(120 * 2));
    // Act
    let tx = await rewardManager.keep();
    // Assert
    expectEvent(tx, "PriceEpochFinalized");
    expectEvent.notEmitted(tx, "RewardEpochFinalized");
  });

  it("Should finalize a reward epoch", async() => {
    // Assemble
    await rewardManager.activate();
    // Time travel 120 seconds
    await time.increaseTo(startTs.addn(172800));
    // Act
    let tx = await rewardManager.keep();
    // Assert
    expectEvent(tx, "RewardEpochFinalized");
  });

  it("Should finalize a reward epoch at the configured interval", async() => {
    // Assemble
    await rewardManager.activate();
    // Time travel 2 days
    await time.increaseTo(startTs.addn(172800));
    await rewardManager.keep();
    // Time travel another 2 days
    await time.increaseTo(startTs.addn(172800 * 2));
    // Act
    let tx = await rewardManager.keep();
    // Assert
    expectEvent(tx, "RewardEpochFinalized");
  });

  it("Should sucessfully add an FTSO", async() => {
    // Assemble
    let anFTSO = await FTSO.new();
    // Act
    let tx = await rewardManager.addFtso(anFTSO.address);
    // Assert
    expectEvent(tx, "FtsoAdded");
    assert.equal(anFTSO.address, await rewardManager.ftsos(0));
  });

  it("Should not add an FTSO if not from governance", async() => {
    // Assemble
    let anFTSO = await FTSO.new();
    // Act
    let addPromise = rewardManager.addFtso(anFTSO.address, {from: accounts[1]});
    // Assert
    expectRevert(addPromise, "only governance");
  });
});
