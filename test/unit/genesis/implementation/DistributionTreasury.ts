import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { DistributionTreasuryInstance, SuicidalMockInstance } from "../../../../typechain-truffle";
import { toBN } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;

const DistributionTreasury = artifacts.require("DistributionTreasury");
const SuicidalMock = artifacts.require("SuicidalMock");
const DistributionToDelegatorsMock = artifacts.require("DistributionToDelegatorsMock");
const GasConsumer = artifacts.require("GasConsumer");

const ONLY_GOVERNANCE_MSG = "only governance";
const ERR_DISTRIBUTION_ONLY = "distribution only";
const ERR_TOO_OFTEN = "too often";
const ERR_TOO_MUCH = "too much";
const ERR_SEND_FUNDS_FAILED = "send funds failed";
const ERR_ALREADY_SET = "already set";
const ERR_WRONG_ADDRESS = "wrong address";
const ERR_ADDRESS_ZERO = "address zero";

const MAX_PULL_AMOUNT_WEI = toBN(663600000).mul(toBN(10).pow(toBN(18)));

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

        it("Should fail calling setContracts from non-governance", async() => {
            let tx = treasury.setContracts(accounts[100], accounts[101]);
            await expectRevert(tx, ONLY_GOVERNANCE_MSG);
        });

        it("Should fail calling setContracts to zero address", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();
            let tx = treasury.setContracts(constants.ZERO_ADDRESS, accounts[101], { from: governance });
            await expectRevert(tx, ERR_ADDRESS_ZERO);
            tx = treasury.setContracts(accounts[100], constants.ZERO_ADDRESS, { from: governance });
            await expectRevert(tx, ERR_ADDRESS_ZERO);
        });

        it("Should fail calling selectDistributionContract with wrong address", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();
            await treasury.setContracts(accounts[100], accounts[101], { from: governance });
            let tx = treasury.selectDistributionContract(accounts[102], { from: governance });
            await expectRevert(tx, ERR_WRONG_ADDRESS);
        });

        it("Should fail calling selectDistributionContract if already selected", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();
            await treasury.setContracts(accounts[100], accounts[101], { from: governance });
            treasury.selectDistributionContract(accounts[101], { from: governance });
            let tx = treasury.selectDistributionContract(accounts[100], { from: governance });
            await expectRevert(tx, ERR_ALREADY_SET);
        });

        it("Should fail calling selectDistributionContract from non-governance", async() => {
            let tx = treasury.selectDistributionContract(accounts[100]);
            await expectRevert(tx, ONLY_GOVERNANCE_MSG);
        });

        it("Should fail calling pullFunds from non-distribution address", async() => {
            let tx = treasury.pullFunds(100);
            await expectRevert(tx, ERR_DISTRIBUTION_ONLY);
        });
        
        it("Should correctly select distribution contract", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            let newaddress = accounts[100];

            await treasury.setContracts(newaddress, accounts[101], { from: governance });
            await treasury.selectDistributionContract(newaddress, { from: governance });

            let distribution = await treasury.selectedDistribution();

            expect(distribution).to.equal(newaddress);
        });

        it("Should send funds if initial distribution is selected", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = accounts[100];
            await treasury.setContracts(distribution, accounts[101], { from: governance });
            const startBalance = toBN(await web3.eth.getBalance(distribution));
            await treasury.selectDistributionContract(distribution, { from: governance });
            const endBalance = toBN(await web3.eth.getBalance(distribution));
            
            expect(endBalance.sub(startBalance).toNumber()).to.equal(10**6);
        });

        it("Should test cases for pullFunds function - distribution to delegators", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = accounts[100];
            let maxpull = 10**6;
            await treasury.setContracts(accounts[99], distribution, { from: governance });
            await treasury.selectDistributionContract(distribution, { from: governance });

            // pull too much funds
            let tx1 = treasury.pullFunds(MAX_PULL_AMOUNT_WEI.muln(2), { from: distribution });
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

        it("Should update lastPull timestamp even if pulling 0 funds", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = accounts[101];
            await treasury.setContracts(accounts[100], distribution, { from: governance });
            await treasury.selectDistributionContract(distribution, { from: governance });

            // pull 0 funds
            await treasury.pullFunds(0, { from: distribution });
            let lastPull = await treasury.lastPullTs();
            let now = await time.latest()
            expect(lastPull.toNumber()).to.equal(now.toNumber());
        });

        it("Should revert at selectDistributionContract (_sendFunds) if receive method is not implemented", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = await GasConsumer.new();
            await treasury.setContracts(distribution.address, accounts[101], { from: governance });

            await expectRevert(treasury.selectDistributionContract(distribution.address, { from: governance }), ERR_SEND_FUNDS_FAILED);
        });

        it("Should revert at pullFunds if receive method is not implemented", async() => {
            await treasury.initialiseFixedAddress();
            let governance = await treasury.governance();

            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = await DistributionToDelegatorsMock.new(treasury.address);
            let maxpull = 10**6;
            await treasury.setContracts(accounts[100], distribution.address, { from: governance });
            await treasury.selectDistributionContract(distribution.address, { from: governance });

            await expectRevert(distribution.pullFunds(maxpull), ERR_SEND_FUNDS_FAILED);
        });
    });
});
