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
    let mintAccountingMock: MockContractInstance;

    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareKeeper = await FlareKeeper.at("0x1000000000000000000000000000000000000002");
        mintAccountingMock = await MockContract.new();
        // Make sure keeper is initialized with a governance address...if may revert if already done.
        try {
            await flareKeeper.initialiseFixedAddress();
            await flareKeeper.setMintAccounting(mintAccountingMock.address);
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
          await flareKeeper.registerToKeep(contractToKeep.address, {from: genesisGovernance});
        });

        afterEach(async() => {
            await flareKeeper.unregisterToKeep(contractToKeep.address, {from: genesisGovernance});
        });

        it("Should keep a contract", async() => {
            // Assemble
            const startBlock = await flareKeeper.systemLastTriggeredAt();
            // Act
            // Wait for some blocks to mine...
            for(let i = 0; i < 5; i++) {
              await new Promise(resolve => {
                setTimeout(resolve, 1000);
              });
              await advanceBlock();  
            }
            // Assert
            const endBlock = await flareKeeper.systemLastTriggeredAt();
            const invocationCount = await contractToKeep.invocationCountForMethod.call(keep);
            assert(endBlock.sub(startBlock).eq(invocationCount));
        });
    });

    describe("mint", async() => {
        it ("Should cause the validator to mint", async() => {
            // Assemble
            const getMintingRequested = web3.utils.sha3("getMintingRequested()")!.slice(0,10); // first 4 bytes is function selector
            // Rig up the mint accounting contract to tell the keeper to mint
            await mintAccountingMock.givenMethodReturnUint(getMintingRequested, 1000);
            const startBlock = await flareKeeper.systemLastTriggeredAt();
            const openingBalance = BN(await web3.eth.getBalance(flareKeeper.address));
            // Act
            // Wait for some blocks to mine...
            for(let i = 0; i < 5; i++) {
                await new Promise(resolve => {
                  setTimeout(resolve, 1000);
                });
                await advanceBlock();  
            }
            // Assert
            // Balance in keeper should be the number of blocks mined times minting requested amount
            const endBlock = await flareKeeper.systemLastTriggeredAt();
            const closingBalance = BN(await web3.eth.getBalance(flareKeeper.address));
            const shouldaMinted = BN(1000).mul((endBlock.sub(startBlock)));
            assert(closingBalance.sub(openingBalance).eq(shouldaMinted));
        });
    });
});
