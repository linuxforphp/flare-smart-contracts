import { expectRevert, time } from '@openzeppelin/test-helpers';
import { StateConnectorInstance } from "../../../../typechain-truffle";
import { increaseTimeTo } from "../../../utils/test-helpers";
const getTestFile = require('../../../utils/constants').getTestFile;

const StateConnector = artifacts.require("StateConnector");

contract(`StateConnector.sol; ${getTestFile(__filename)}; State connector unit tests`, async accounts => {

    // contains a fresh contract for each test 
    let stateConnector: StateConnectorInstance;

    describe("basic", async() => {
        beforeEach(async() => {
            stateConnector = await StateConnector.new();
            await stateConnector.initialiseChains();
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
