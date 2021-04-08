const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../utils/constants').getTestFile;

const FlareKeeper = artifacts.require("FlareKeeper");
const RewardManager = artifacts.require("RewardManager");
const InflationMock = artifacts.require("MockContract");

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`RewardManager.sol; ${getTestFile(__filename)}; RewardManager system tests`, async accounts => {
    // Static address of the keeper on a local network
    let flareKeeper;
    // fresh contracts for each test
    let inflationMock;
    let startTs;

    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareKeeper = await FlareKeeper.at("0x1000000000000000000000000000000000000002");
        // Make sure keeper is initialized with a governance address...if may revert if already done.
        try {
            await flareKeeper.initialise(accounts[1]);
        } catch (e) {
            // keep going
        }
    });

    beforeEach(async() => {
        inflationMock = await InflationMock.new();
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();
    });

    describe("keep", async() => {
        it("Should by kept by keeper", async() => {
            // Assemble
            const rewardManager = await RewardManager.new(
                accounts[1],
                inflationMock.address,
                172800,                      // Reward epoch 2 days
                120,                         // Price epoch 2 minutes
                startTs,
                startTs        
            );
            await flareKeeper.registerToKeep(rewardManager.address, {from: accounts[1]});
            // Act
            await rewardManager.activate({from: accounts[1]});
            // Assert
            // If the keeper is calling keep on the RewardManager, then there should be
            // an active reward epoch.
            const { startBlock } = await rewardManager.rewardEpochs(0);
            assert(startBlock.toNumber() != 0);
        });
    });
});