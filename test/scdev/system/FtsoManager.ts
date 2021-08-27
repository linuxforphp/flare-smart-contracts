import { FlareDaemonInstance, 
  MockContractInstance } from "../../../typechain-truffle";

import {time} from '@openzeppelin/test-helpers';
const getTestFile = require('../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;
import { advanceBlock } from '../../utils/test-helpers';
import { spewDaemonErrors } from "../../utils/FlareDaemonTestUtils";
import { FLARE_DAEMON_ADDRESS } from "../../utils/constants";

const BN = web3.utils.toBN;

const FlareDaemon = artifacts.require("FlareDaemon");
const FtsoManager = artifacts.require("FtsoManager");
const RewardManagerMock = artifacts.require("MockContract");
const MockContract = artifacts.require("MockContract");


/**
 * This test assumes a local chain is running with Native allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the FlareDaemon, which should
 * already be loaded in the genesis block.
 */
 contract(`FtsoManager.sol; ${getTestFile(__filename)}; FtsoManager system tests`, async accounts => {
    // Static address of the daemon on a local network
    let flareDaemon: FlareDaemonInstance;

    // fresh contracts for each test
    let rewardManagerMock: MockContractInstance;
    let startTs: any;
    let mintAccountingMock: MockContractInstance;


    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareDaemon = await FlareDaemon.at(FLARE_DAEMON_ADDRESS);
        mintAccountingMock = await MockContract.new();
        // Make sure daemon is initialized with a governance address...if may revert if already done.
        try {
            await flareDaemon.initialiseFixedAddress();
            await flareDaemon.setMintAccounting(mintAccountingMock.address);
        } catch (e) {
            const governanceAddress = await flareDaemon.governance();
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

    describe("daemonize", async() => {
        it("Should be daemonized by daemon", async() => {
            // Assemble
            const ftsoManager = await FtsoManager.new(
              accounts[1],
              flareDaemon.address,
              rewardManagerMock.address,
              accounts[7],
              accounts[8],
              accounts[9],
              60,
              startTs,
              5,
              600,
              startTs + 5,
              0
            );
            const fromBlock = await flareDaemon.systemLastTriggeredAt();
            await flareDaemon.registerToDaemonize([{daemonizedContract: ftsoManager.address, gasLimit: 0}], {from: GOVERNANCE_GENESIS_ADDRESS});
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
            // If the daemon is calling daemonize on the RewardManager, then there should be
            // an active reward epoch.
            const toBlock = await flareDaemon.systemLastTriggeredAt();
            assert.equal(await spewDaemonErrors(flareDaemon, fromBlock, toBlock), 0);
            const { 1: rewardEpochStartBlock } = await ftsoManager.rewardEpochs(0);
            assert(rewardEpochStartBlock.toNumber() != 0);
        });
    });
});
