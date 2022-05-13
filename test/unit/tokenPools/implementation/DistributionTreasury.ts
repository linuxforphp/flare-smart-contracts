import { 
    DistributionTreasuryInstance, 
    MockContractInstance, SuicidalMockInstance
} from "../../../../typechain-truffle";

import { time, expectRevert, expectEvent} from '@openzeppelin/test-helpers';
import { GOVERNANCE_GENESIS_ADDRESS } from '../../../utils/constants';
const getTestFile = require('../../../utils/constants').getTestFile;

const DistributionTreasury = artifacts.require("DistributionTreasury");
const SuicidalMock = artifacts.require("SuicidalMock");

const ONLY_GOVERNANCE_MSG = "only governance";
const ERR_DISTRIBUTION_ONLY = "distribution only";
const ERR_TOO_OFTEN = "too often";
const ERR_TOO_MUCH = "too much";
const ERR_PULL_FAILED = "pull failed";

contract(`DistributionTreasury.sol; ${getTestFile(__filename)}; DistributionTreasury unit tests`, async accounts => {
    let treasury: DistributionTreasuryInstance;
    let mockSuicidal: SuicidalMockInstance;

    beforeEach(async() => {
        treasury = await DistributionTreasury.new();
        mockSuicidal = await SuicidalMock.new(treasury.address);
    });

    describe("methods", async() => {

        it("Should initialize governance", async() => {
           let tx = await treasury.initialiseFixedAddress();
           expectEvent(tx, "GovernanceUpdated");
        });

        it("Should fail calling setDistributionContract from non-governance", async() => {
            let tx = treasury.setDistributionContract(accounts[100], 10);
            await expectRevert(tx, ONLY_GOVERNANCE_MSG);
        });

        it("Should fail calling pullFunds from non-distribution address", async() => {
            let tx = treasury.pullFunds(100);
            await expectRevert(tx, ERR_DISTRIBUTION_ONLY);
        });
        
        it("Should correctly set distributer and max wei, then pull", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            let newaddress = accounts[100];
            let newmaxpull = 10**6;

            await treasury.setDistributionContract(newaddress, newmaxpull, { from: governance });

            let distribution = await treasury.distribution();
            let maxPullAmountWei = (await treasury.maxPullAmountWei()).toNumber();

            expect(distribution).to.equal(newaddress);
            expect(maxPullAmountWei).to.equal(newmaxpull);
        });

        it("Should test cases for pullFunds function", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = accounts[100];
            let maxpull = 10**6;
            await treasury.setDistributionContract(distribution, maxpull, { from: governance });

            // pull too much funds
            let tx1 = treasury.pullFunds(2 * maxpull, { from: distribution });
            await expectRevert(tx1, ERR_TOO_MUCH);

            // pull half the funds
            await treasury.pullFunds(Math.floor(maxpull / 2), { from: distribution });
            let lastPull = await treasury.lastPullTs();
            let now = await time.latest()
            expect(lastPull.toNumber()).to.equal(now.toNumber());

            // pull half the funds and fail
            let tx2 = treasury.pullFunds(Math.floor(maxpull / 2), { from: distribution });
            await expectRevert(tx2, ERR_TOO_OFTEN);

            // pull the other half after MAX_PULL_FREQUENCY_SEC
            await time.increaseTo(now.addn(29 * 60 * 60 * 24));
            await treasury.pullFunds(Math.floor(maxpull / 2), { from: distribution });
            let lastPull2 = await treasury.lastPullTs();
            let now2 = await time.latest()
            expect(lastPull2.toNumber()).to.equal(now2.toNumber());
        });

    });
});
