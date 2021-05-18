import { FlareKeeperInstance, 
  MockContractInstance } from "../../../typechain-truffle";

const {time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;
const genesisGovernance = require('../../utils/constants').genesisGovernance;

const FlareKeeper = artifacts.require("FlareKeeper");
const FtsoManager = artifacts.require("FtsoManager");
const RewardManagerMock = artifacts.require("MockContract");

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`FtsoManager.sol; ${getTestFile(__filename)}; FtsoManager system tests`, async accounts => {
    // Static address of the keeper on a local network
    let flareKeeper: FlareKeeperInstance;

    // fresh contracts for each test
    let rewardManagerMock: MockContractInstance;
    let startTs: any;

    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareKeeper = await FlareKeeper.at("0x1000000000000000000000000000000000000002");
        // Make sure keeper is initialized with a governance address...if may revert if already done.
        try {
            await flareKeeper.initialiseFixedAddress();
        } catch (e) {
            const governanceAddress = await flareKeeper.governance();
            if (genesisGovernance != governanceAddress) {
                throw e;
            }
            // keep going
        }
    });

    beforeEach(async() => {
        rewardManagerMock = await RewardManagerMock.new();
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();
    });

    describe("keep", async() => {
        it("Should by kept by keeper", async() => {
            // Assemble
            const ftsoManager = await FtsoManager.new(
              accounts[1],
              rewardManagerMock.address,
              accounts[7],
              60,
              startTs,
              5,
              600,
              startTs,
              0
            );
            await flareKeeper.registerToKeep(ftsoManager.address, {from: genesisGovernance});
            // Act
            await ftsoManager.activate({from: accounts[1]});
            // Assert
            // If the keeper is calling keep on the RewardManager, then there should be
            // an active reward epoch.
            const { 1: startBlock } = await ftsoManager.rewardEpochs(0);
            assert(startBlock.toNumber() != 0);
        });
    });
});
