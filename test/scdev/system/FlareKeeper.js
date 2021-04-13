const FlareKeeper = artifacts.require("FlareKeeper");
const Kept = artifacts.require("Kept");

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`FlareKeeper system tests`, async accounts => {
    // Static address of the keeper on a local network
    let flareKeeper;

    // contains a fresh contract for each test
    let contractToKeep;

    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
        flareKeeper = await FlareKeeper.at("0x1000000000000000000000000000000000000002");
        // Make sure keeper is initialized with a governance address...if may revert if already done.
        try {
            await flareKeeper.initialise(accounts[1]);
        } catch (e) {
            console.log("Error caught initializing FlareKeeper; already initialized?: %s", e.message);
            // keep going
        }
    });

    beforeEach(async() => {
        contractToKeep = await Kept.new();
        await flareKeeper.registerToKeep(contractToKeep.address, {from: accounts[1]});
    });

    afterEach(async() => {
        await flareKeeper.unregisterToKeep(contractToKeep.address, {from: accounts[1]});
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