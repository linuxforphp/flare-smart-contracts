import { FlareKeeperInstance, KeptInstance } from "../../../typechain-truffle";

const FlareKeeper = artifacts.require("FlareKeeper");
const Kept = artifacts.require("Kept");

const getTestFile = require('../../utils/constants').getTestFile;
const genesisGovernance = require('../../utils/constants').genesisGovernance;

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`FlareKeeper.sol; ${getTestFile(__filename)}; FlareKeeper system tests`, async accounts => {
    // Static address of the keeper on a local network
    let flareKeeper: FlareKeeperInstance;

    // contains a fresh contract for each test
    let contractToKeep: KeptInstance;

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
        contractToKeep = await Kept.new();
        await flareKeeper.registerToKeep(contractToKeep.address, {from: genesisGovernance});
    });

    afterEach(async() => {
        await flareKeeper.unregisterToKeep(contractToKeep.address, {from: genesisGovernance});
    });

    describe("keep", async() => {
        it("Should keep a contract", async() => {
            // Assemble
            const oldLastKeptBlock = await contractToKeep.lastKept();
            // Act
            await contractToKeep.tickle();
            // Assert
            const lastKeptBlock = await contractToKeep.lastKept();
            assert(oldLastKeptBlock.toNumber() != lastKeptBlock.toNumber());
        });
    });
});