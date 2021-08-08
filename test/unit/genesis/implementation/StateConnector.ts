import { constants, expectRevert, expectEvent, time } from '@openzeppelin/test-helpers';
import { StateConnectorInstance } from "../../../../typechain-truffle";
import { increaseTimeTo, toBN } from "../../../utils/test-helpers";
const getTestFile = require('../../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;

const StateConnector = artifacts.require("StateConnector");

contract(`StateConnector.sol; ${getTestFile(__filename)}; State connector unit tests`, async accounts => {

    // contains a fresh contract for each test 
    let stateConnector: StateConnectorInstance;

    describe("basic", async() => {
        beforeEach(async() => {
            stateConnector = await StateConnector.new();
            await stateConnector.initialiseChains();
        });

        it("Should not know about governance address before initialization", async() => {
            stateConnector = await StateConnector.new();
            expect(await stateConnector.initialised()).to.be.false;
            expect(await stateConnector.getGovernanceContract()).to.equals(constants.ZERO_ADDRESS);
        });

        it("Should know about governance address after initialization", async() => {
            expect(await stateConnector.initialised()).to.be.true;
            expect((await stateConnector.initialiseTime()).toNumber()).to.be.lte((await time.latest()).toNumber());
            expect(await stateConnector.getGovernanceContract()).to.equals(GOVERNANCE_GENESIS_ADDRESS);
            expect(await stateConnector.governanceContract()).to.equals(GOVERNANCE_GENESIS_ADDRESS);
        });

        it("Should know about reward period after initialization", async() => {
            expect(await stateConnector.initialised()).to.be.true;
            expect((await stateConnector.initialiseTime()).toNumber()).to.be.lte((await time.latest()).toNumber());
            expect((await stateConnector.rewardPeriodTimespan()).toNumber()).to.equals(604800);
        });

        it("Should not initialise twice", async() => {
            expect(await stateConnector.initialised()).to.be.true;
            await expectRevert(stateConnector.initialiseChains(), "initialised != false");
        });

        it("Should set new governance address", async() => {
            await stateConnector.setGovernanceContract(accounts[2], { from: GOVERNANCE_GENESIS_ADDRESS });
            expect(await stateConnector.getGovernanceContract()).to.equals(accounts[2]);
        });

        it("Should not set new governance address to 0x0", async() => {
            await expectRevert(stateConnector.setGovernanceContract(constants.ZERO_ADDRESS, { from: GOVERNANCE_GENESIS_ADDRESS }), "_governanceContract == 0x0");
            expect(await stateConnector.getGovernanceContract()).to.equals(GOVERNANCE_GENESIS_ADDRESS);
        });

        it("Should not set new governance address if not from governance", async() => {
            await expectRevert(stateConnector.setGovernanceContract(accounts[2], { from: accounts[1] }), "msg.sender != governanceContract");
            expect(await stateConnector.getGovernanceContract()).to.equals(GOVERNANCE_GENESIS_ADDRESS);
        });

        it("Should add new chain", async() => {
            const numChainsOld = await stateConnector.numChains();
            //uint64 genesisLedger, uint64 ledgerHistorySize, uint16 claimPeriodLength, uint16 numConfirmations, uint256 timeDiffExpected
            expectEvent(await stateConnector.addChain(100, 5, 10, 50, 60, { from: GOVERNANCE_GENESIS_ADDRESS }), "ChainAdded", {chainId: numChainsOld, add: true});
            expect((await stateConnector.numChains()).toNumber()).to.equals(numChainsOld.toNumber() + 1);

            const data = await stateConnector.chains(numChainsOld);
            expect(data[0]).to.be.true;
            expect(data[1].toNumber()).to.equals(100);
            expect(data[2].toNumber()).to.equals(5);
            expect(data[3].toNumber()).to.equals(10);
            expect(data[4].toNumber()).to.equals(50);
            expect(data[5].toNumber()).to.equals(0);
            expect(data[6].toNumber()).to.equals(100);
            expect(data[7].toNumber()).to.be.lte((await time.latest()).toNumber());
            expect(data[8].toNumber()).to.equals(60);
            expect(data[9].toNumber()).to.equals(0);
        });

        it("Should not add new chain if not from governance", async() => {
            const numChainsOld = await stateConnector.numChains();
            //uint64 genesisLedger, uint64 ledgerHistorySize, uint16 claimPeriodLength, uint16 numConfirmations, uint256 timeDiffExpected
            await expectRevert(stateConnector.addChain(100, 0, 10, 50, 60, { from: accounts[1] }), "msg.sender != governanceContract");
            expect((await stateConnector.numChains()).toNumber()).to.equals(numChainsOld.toNumber());
        });

        it("Should not add new chain if claimPeriodLength == 0", async() => {
            const numChainsOld = await stateConnector.numChains();
            //uint64 genesisLedger, uint64 ledgerHistorySize, uint16 claimPeriodLength, uint16 numConfirmations, uint256 timeDiffExpected
            await expectRevert(stateConnector.addChain(100, 0, 0, 50, 60, { from: GOVERNANCE_GENESIS_ADDRESS }), "claimPeriodLength == 0");
            expect((await stateConnector.numChains()).toNumber()).to.equals(numChainsOld.toNumber());
        });

        it("Should not add new chain if numConfirmations == 0", async() => {
            const numChainsOld = await stateConnector.numChains();
            //uint64 genesisLedger, uint64 ledgerHistorySize, uint16 claimPeriodLength, uint16 numConfirmations, uint256 timeDiffExpected
            await expectRevert(stateConnector.addChain(100, 0, 10, 0, 60, { from: GOVERNANCE_GENESIS_ADDRESS }), "numConfirmations == 0");
            expect((await stateConnector.numChains()).toNumber()).to.equals(numChainsOld.toNumber());
        });
        
        it("Should not add new chain if genesisLedger <= numConfirmations", async() => {
            const numChainsOld = await stateConnector.numChains();
            //uint64 genesisLedger, uint64 ledgerHistorySize, uint16 claimPeriodLength, uint16 numConfirmations, uint256 timeDiffExpected
            await expectRevert(stateConnector.addChain(100, 0, 10, 100, 60, { from: GOVERNANCE_GENESIS_ADDRESS }), "genesisLedger <= numConfirmations");
            await expectRevert(stateConnector.addChain(100, 0, 10, 110, 60, { from: GOVERNANCE_GENESIS_ADDRESS }), "genesisLedger <= numConfirmations");
            expect((await stateConnector.numChains()).toNumber()).to.equals(numChainsOld.toNumber());
        });

        it("Should disable chain", async() => {
            expect((await stateConnector.chains(0))[0]).to.be.true;
            expectEvent(await stateConnector.disableChain(0, { from: GOVERNANCE_GENESIS_ADDRESS }), "ChainAdded", {chainId: toBN(0), add: false});
            expect((await stateConnector.chains(0))[0]).to.be.false;
        });

        it("Should not disable chain if not from governance", async() => {
            expect((await stateConnector.chains(0))[0]).to.be.true;
            await expectRevert(stateConnector.disableChain(0, { from: accounts[1] }), "msg.sender != governanceContract");
            expect((await stateConnector.chains(0))[0]).to.be.true;
        });

        it("Should not disable chain if already disabled or does not exist", async() => {
            expect((await stateConnector.chains(0))[0]).to.be.true;
            expectEvent(await stateConnector.disableChain(0, { from: GOVERNANCE_GENESIS_ADDRESS }), "ChainAdded", {chainId: toBN(0), add: false});
            expect((await stateConnector.chains(0))[0]).to.be.false;

            await expectRevert(stateConnector.disableChain(0, { from: GOVERNANCE_GENESIS_ADDRESS }), "chainId does not exist");
            await expectRevert(stateConnector.disableChain(1000, { from: GOVERNANCE_GENESIS_ADDRESS }), "chainId does not exist");
        });

        it("Should enable chain", async() => {
            await stateConnector.disableChain(0, { from: GOVERNANCE_GENESIS_ADDRESS });
            expect((await stateConnector.chains(0))[0]).to.be.false;

            expectEvent(await stateConnector.enableChain(0, { from: GOVERNANCE_GENESIS_ADDRESS }), "ChainAdded", {chainId: toBN(0), add: true});
            expect((await stateConnector.chains(0))[0]).to.be.true;
        });

        it("Should not enable chain if not from governance", async() => {
            await stateConnector.disableChain(0, { from: GOVERNANCE_GENESIS_ADDRESS });
            expect((await stateConnector.chains(0))[0]).to.be.false;

            await expectRevert(stateConnector.enableChain(0, { from: accounts[1] }), "msg.sender != governanceContract");
            expect((await stateConnector.chains(0))[0]).to.be.false;
        });

        it("Should not enable chain if already enabled or does not exist", async() => {
            await expectRevert(stateConnector.enableChain(0, { from: GOVERNANCE_GENESIS_ADDRESS }), "chains[chainId].exists == true");
            await expectRevert(stateConnector.enableChain(1000, { from: GOVERNANCE_GENESIS_ADDRESS }), "chainId >= numChains");
        });

        it("Should get correct reward period", async() => {
            await expectRevert(stateConnector.getRewardPeriod(), "block.timestamp <= initialiseTime")
            
            const initialiseTime = (await stateConnector.initialiseTime()).toNumber();
            await increaseTimeTo(initialiseTime + 1);
            expect((await stateConnector.getRewardPeriod()).toNumber()).to.equals(0);
            
            await increaseTimeTo(initialiseTime + 604800);
            expect((await stateConnector.getRewardPeriod()).toNumber()).to.equals(1);

            await increaseTimeTo(initialiseTime + 10 * 604800 - 1);
            expect((await stateConnector.getRewardPeriod()).toNumber()).to.equals(9);

            await increaseTimeTo(initialiseTime + 10 * 604800);
            expect((await stateConnector.getRewardPeriod()).toNumber()).to.equals(10);
        });
    });
});
