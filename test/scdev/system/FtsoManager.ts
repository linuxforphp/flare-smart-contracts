import { FlareKeeperInstance, 
  MockContractInstance } from "../../../typechain-truffle";

import {time} from '@openzeppelin/test-helpers';
const getTestFile = require('../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;
import { advanceBlock } from '../../utils/test-helpers';
import { spewKeeperErrors } from "../../utils/FlareKeeperTestUtils";
import { FLARE_KEEPER_ADDRESS } from "../../utils/constants";

const BN = web3.utils.toBN;

const FlareKeeper = artifacts.require("FlareKeeper");
const FtsoManager = artifacts.require("FtsoManager");
const RewardManagerMock = artifacts.require("MockContract");
const MockContract = artifacts.require("MockContract");


/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the FlareKeeper, which should
 * already be loaded in the genesis block.
 */
 contract(`FtsoManager.sol; ${getTestFile(__filename)}; FtsoManager system tests`, async accounts => {
    // Static address of the keeper on a local network
    let flareKeeper: FlareKeeperInstance;

    // fresh contracts for each test
    let rewardManagerMock: MockContractInstance;
    let startTs: any;
    let mintAccountingMock: MockContractInstance;


    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareKeeper = await FlareKeeper.at(FLARE_KEEPER_ADDRESS);
        mintAccountingMock = await MockContract.new();
        // Make sure keeper is initialized with a governance address...if may revert if already done.
        try {
            await flareKeeper.initialiseFixedAddress();
            await flareKeeper.setMintAccounting(mintAccountingMock.address);
        } catch (e) {
            const governanceAddress = await flareKeeper.governance();
            if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
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
        it("Should be kept by keeper", async() => {
            // Assemble
            const ftsoManager = await FtsoManager.new(
              accounts[1],
              flareKeeper.address,
              rewardManagerMock.address,
              accounts[7],
              accounts[8],
              60,
              startTs,
              5,
              600,
              startTs,
              0
            );
            const fromBlock = await flareKeeper.systemLastTriggeredAt();
            await flareKeeper.registerToKeep([{keptContract: ftsoManager.address, gasLimit: 0}], {from: GOVERNANCE_GENESIS_ADDRESS});
            // Act
            await ftsoManager.activate({from: accounts[1]});
            // Wait for some blocks to mine...
            for(let i = 0; i < 5; i++) {
              await new Promise(resolve => {
                setTimeout(resolve, 1000);
              });
              await advanceBlock();  
            }
            // Assert
            // If the keeper is calling keep on the RewardManager, then there should be
            // an active reward epoch.
            const toBlock = await flareKeeper.systemLastTriggeredAt();
            assert.equal(await spewKeeperErrors(flareKeeper, fromBlock, toBlock), 0);
            const { 1: rewardEpochStartBlock } = await ftsoManager.rewardEpochs(0);
            assert(rewardEpochStartBlock.toNumber() != 0);
        });
    });
});
