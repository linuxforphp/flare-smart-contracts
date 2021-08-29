import { time } from '@openzeppelin/test-helpers';
import {
    InflationMockInstance, StateConnectorMockInstance,
    DataAvailabilityRewardManagerInstance
} from "../../../typechain-truffle";


const getTestFile = require('../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const StateConnectorMock = artifacts.require("StateConnectorMock");
const DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");
const InflationMock = artifacts.require("InflationMock");

contract(`DataAvailabilityRewardManager.sol and StateConnector.sol; ${ getTestFile(__filename) }; Data availability reward manager and State connector integration tests`, async accounts => {
    // contains a fresh contract for each test
    let stateConnectorMock: StateConnectorMockInstance;
    let dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance;
    let startTs: BN;
    let mockInflation: InflationMockInstance;

    beforeEach(async () => {
        mockInflation = await InflationMock.new();
        stateConnectorMock = await StateConnectorMock.new();
        dataAvailabilityRewardManager = await DataAvailabilityRewardManager.new( accounts[0], 10, stateConnectorMock.address, mockInflation.address);

        await mockInflation.setInflationReceiver(dataAvailabilityRewardManager.address);
        await stateConnectorMock.initialiseChains();
        await dataAvailabilityRewardManager.activate();

        // Get the timestamp for the just mined block
        startTs = await time.latest();
    });

    describe("reward claiming", async () => {

        it("Should enable rewards to be claimed once reward epoch finalized", async () => {
            // Assemble
            // set some claim periods mined
            await stateConnectorMock.addNewDataAvailabilityPeriodsMined(accounts[1]);
            await stateConnectorMock.addNewDataAvailabilityPeriodsMined(accounts[1]);
            await stateConnectorMock.addNewDataAvailabilityPeriodsMined(accounts[1]);

            await stateConnectorMock.addNewDataAvailabilityPeriodsMined(accounts[2]);
            await stateConnectorMock.addNewDataAvailabilityPeriodsMined(accounts[2]);

            // give reward manager some nat to distribute
            await mockInflation.receiveInflation({ value: "1500" } );

            const rewardPeriodTimespan = await stateConnectorMock.rewardPeriodTimespan();

            // Time travel to inflation authorization
            await time.increaseTo(startTs.add(rewardPeriodTimespan.divn(2)));
            await mockInflation.setDailyAuthorizedInflation(BN(1000));

            // Time travel to reward epoch finalizaion time
            await time.increaseTo(startTs.add(rewardPeriodTimespan));
            await mockInflation.setDailyAuthorizedInflation(BN(1000)); // distribute rewards

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await dataAvailabilityRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });

            // Assert
            // inflation authorized = 2000
            // a1 -> a3 claimed should be 2000 * 3 / 5  = 1200
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), Math.floor(2000 * 3 / 5));
        });
    });
});
