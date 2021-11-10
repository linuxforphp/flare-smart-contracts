import { expectRevert } from "@openzeppelin/test-helpers";
import { FlareDaemonInstance, MockContractInstance } from "../../../typechain-truffle";
import { FLARE_DAEMON_ADDRESS } from "../../utils/constants";

const FlareDaemon = artifacts.require("FlareDaemon");
const MockContract = artifacts.require("MockContract");

const BN = web3.utils.toBN;
const getTestFile = require('../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;
import { advanceBlock } from '../../utils/test-helpers';

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the FlareDaemon, which should
 * already be loaded in the genesis block.
 */
contract(`FlareDaemon.sol; ${getTestFile(__filename)}; FlareDaemon system tests`, async accounts => {
    // Static address of the daemon on a local network
    let flareDaemon: FlareDaemonInstance;
    // contains a fresh contract for each test
    let contractToDaemonize: MockContractInstance;
    let inflationMock: MockContractInstance;

    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareDaemon = await FlareDaemon.at(FLARE_DAEMON_ADDRESS);
        inflationMock = await MockContract.new();
        // Make sure daemon is initialized with a governance address...if may revert if already done.
        try {
            await flareDaemon.initialiseFixedAddress();
            await flareDaemon.setInflation(inflationMock.address);
        } catch (e) {
            const governanceAddress = await flareDaemon.governance();
            if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
                throw e;
            }
            // keep going
        }
    });


    describe("daemonize", async() => {
        let daemonize: string;

        beforeEach(async() => {
          contractToDaemonize = await MockContract.new();
          daemonize = web3.utils.sha3("daemonize()")!.slice(0,10); // first 4 bytes is function selector
          // Give our contract to keep a daemonize method so our poor validator's head does not explode...
          await contractToDaemonize.givenMethodReturnBool(daemonize, true);
          await flareDaemon.registerToDaemonize([{daemonizedContract: contractToDaemonize.address, gasLimit: 0}], {from: GOVERNANCE_GENESIS_ADDRESS});
        });

        it("Should daemonize a contract", async() => {
            // Assemble
            const startInvocationCount = await contractToDaemonize.invocationCountForMethod.call(daemonize);
            // Act
            // Wait for some blocks to mine...
            const blocks = 2;
            for(let i = 0; i < blocks; i++) {
              await new Promise(resolve => {
                setTimeout(resolve, 1000);
              });
              await advanceBlock();  
            }
            // Assert
            const endInvocationCount = await contractToDaemonize.invocationCountForMethod.call(daemonize);
            assert(endInvocationCount.sub(startInvocationCount).eq(BN(blocks)));
        });

        it("Should revert if user triggers function trigger", async() => {
          await expectRevert.unspecified(flareDaemon.trigger());
          await expectRevert.unspecified(flareDaemon.trigger({from: accounts[1]}));
        });
    });
});
