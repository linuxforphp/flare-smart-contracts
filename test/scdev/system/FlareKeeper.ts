import { FlareKeeperInstance, MockContractInstance } from "../../../typechain-truffle";

const FlareKeeper = artifacts.require("FlareKeeper");
const MockContract = artifacts.require("MockContract");

const BN = web3.utils.toBN;
const getTestFile = require('../../utils/constants').getTestFile;
const genesisGovernance = require('../../utils/constants').genesisGovernance;
import { advanceBlock } from '../../utils/test-helpers';

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the FlareKeeper, which should
 * already be loaded in the genesis block.
 */
contract(`FlareKeeper.sol; ${getTestFile(__filename)}; FlareKeeper system tests`, async accounts => {
    // Static address of the keeper on a local network
    let flareKeeper: FlareKeeperInstance;
    // contains a fresh contract for each test
    let contractToKeep: MockContractInstance;
    let inflationMock: MockContractInstance;

    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareKeeper = await FlareKeeper.at("0x1000000000000000000000000000000000000002");
        inflationMock = await MockContract.new();
        // Make sure keeper is initialized with a governance address...if may revert if already done.
        try {
            await flareKeeper.initialiseFixedAddress();
            await flareKeeper.setInflation(inflationMock.address);
        } catch (e) {
            const governanceAddress = await flareKeeper.governance();
            if (genesisGovernance != governanceAddress) {
                throw e;
            }
            // keep going
        }
    });


    describe("keep", async() => {
        let keep: string;

        beforeEach(async() => {
          contractToKeep = await MockContract.new();
          keep = web3.utils.sha3("keep()")!.slice(0,10); // first 4 bytes is function selector
          // Give our contract to keep a keep method so our poor validator's head does not explode...
          await contractToKeep.givenMethodReturnBool(keep, true);
          await flareKeeper.registerToKeep([{keptContract: contractToKeep.address, gasLimit: 0}], {from: genesisGovernance});
        });

        it("Should keep a contract", async() => {
            // Assemble
            const startInvocationCount = await contractToKeep.invocationCountForMethod.call(keep);
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
            const endInvocationCount = await contractToKeep.invocationCountForMethod.call(keep);
            assert(endInvocationCount.sub(startInvocationCount).eq(BN(blocks)));
        });
    });
});
