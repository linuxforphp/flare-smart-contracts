import {
    CloseManagerInstance,
    FlareNetworkGeneralLedgerInstance,
    FtsoInflationAccountingInstance,
    FtsoInflationAuthorizerInstance,
    FtsoInstance,
    FtsoManagerInstance,
    FtsoRewardManagerAccountingInstance,
    MockContractInstance,
    FtsoRewardManagerInstance,
    SupplyAccountingInstance,
    WFlrInstance
} from "../../../typechain-truffle";

import { setDefaultGovernanceParameters } from "../../utils/FtsoManager-test-utils";

const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";

const BN = web3.utils.toBN;


const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoInflationAuthorizer = artifacts.require("FtsoInflationAuthorizer");
const Ftso = artifacts.require("Ftso");
const MockContract = artifacts.require("MockContract");
const WFLR = artifacts.require("WFlr");
const FtsoRewardManagerAccounting = artifacts.require("FtsoRewardManagerAccounting");
const FlareNetworkGeneralLedger = artifacts.require("FlareNetworkGeneralLedger");
const SupplyAccounting = artifacts.require("SupplyAccounting");
const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting");
const CloseManager = artifacts.require("CloseManager");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`RewardManager.sol and FtsoManager.sol; ${ getTestFile(__filename) }; Reward manager and Ftso manager integration tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let ftsoManager: FtsoManagerInstance;
    let ftsoInflationAuthorizer: FtsoInflationAuthorizerInstance;
    let mockInflationPercentageProvider: MockContractInstance;
    let startTs: BN;
    let mockFtso: MockContractInstance;
    let ftsoInterface: FtsoInstance;
    let wFlr: WFlrInstance;
    let ftsoRewardManagerAccounting: FtsoRewardManagerAccountingInstance;
    let gl: FlareNetworkGeneralLedgerInstance;
    let supplyAccounting: SupplyAccountingInstance;
    let ftsoInflationAccounting: FtsoInflationAccountingInstance;
    let fakeFlareKeeperAddress = accounts[1];
    let closeManager: CloseManagerInstance;

    beforeEach(async () => {
        mockFtso = await MockContract.new();
        ftsoInterface = await Ftso.new(
            "FLR",
            constants.ZERO_ADDRESS as any,
            constants.ZERO_ADDRESS as any,
            0
        );

        closeManager = await CloseManager.new(accounts[0]);
        mockInflationPercentageProvider = await MockContract.new()
        const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0, 10);
        // Allocate at 9%
        await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, 1000);

        // Wire up accounting system
        gl = await FlareNetworkGeneralLedger.new(accounts[0]);
        ftsoRewardManagerAccounting = await FtsoRewardManagerAccounting.new(accounts[0], gl.address);
        await gl.grantRole(await gl.POSTER_ROLE(), ftsoRewardManagerAccounting.address);
        supplyAccounting = await SupplyAccounting.new(gl.address);
        ftsoInflationAccounting = await FtsoInflationAccounting.new(accounts[0], gl.address);
        await gl.grantRole(await gl.POSTER_ROLE(), ftsoInflationAccounting.address);

        // Put some balance into the genesis account, otherwise there will not be an inflatable balance.
        await gl.grantRole(await gl.POSTER_ROLE(), accounts[0]);
        const journalEntries = [];
        journalEntries[0] = { accountName: FlareNetworkChartOfAccounts.GENESIS, debit: "1000000000", credit: 0 };
        journalEntries[1] = { accountName: FlareNetworkChartOfAccounts.GENESIS_TOKEN, debit: 0, credit: "1000000000" };
        await gl.post(journalEntries);

        // Wire up inflation authorizer
        ftsoInflationAuthorizer = await FtsoInflationAuthorizer.new(
          accounts[0],
          86400,
          0,
          mockInflationPercentageProvider.address,
          supplyAccounting.address,
          closeManager.address,
          ftsoInflationAccounting.address);
        // FtsoInflationAuthorizer will post to the FtsoInflationAccounting contract
        await ftsoInflationAccounting.grantRole(await ftsoInflationAccounting.POSTER_ROLE(), ftsoInflationAuthorizer.address);
        // Prime the inflation authorizer so we get a new annum
        await ftsoInflationAuthorizer.keep();

        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoRewardManager = await FtsoRewardManager.new(
            accounts[0],
            ftsoRewardManagerAccounting.address,
            supplyAccounting.address,
            3,
            0,
            100,
            closeManager.address
        );
        // RewardManager will post to the reward manager accounting contract
        await ftsoRewardManagerAccounting.grantRole(await ftsoRewardManagerAccounting.POSTER_ROLE(), ftsoRewardManager.address);
        closeManager.registerToClose(ftsoRewardManager.address);

        ftsoManager = await FtsoManager.new(
            accounts[0],
            ftsoRewardManager.address,
            accounts[7],
            ftsoInflationAuthorizer.address,
            PRICE_EPOCH_DURATION_S,
            startTs,
            REVEAL_EPOCH_DURATION_S,
            REWARD_EPOCH_DURATION_S,
            startTs,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        wFlr = await WFLR.new();

        await ftsoRewardManager.setFTSOManager(ftsoManager.address);
        await ftsoRewardManager.setWFLR(wFlr.address);
        await ftsoRewardManager.setFlareKeeper(fakeFlareKeeperAddress);
        await ftsoRewardManager.activate();
    });

    describe("Price epochs, finalization", async () => {

        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            // Assemble
            // stub ftso randomizer
            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
                ['address[]', 'uint256[]', 'uint256'],
                [[accounts[1], accounts[2]], [25, 75], 100]);
            await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: fakeFlareKeeperAddress, to: ftsoRewardManager.address, value: 1000000 });

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });

            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling ftso manager
            await ftsoManager.keep();

            // Assert
            // 282600 is number of 2 minute price epochs in 1 year
            // 100000000 is 10% inflation on 1000000000
            // a1 should be (100000000 / 262800) * 0.25 = 95.129
            // a2 should be = (100000000 / 262800) * 0.75 = 285.388
            // There is a remainder. It is not being allocated. It should get progressively
            // smaller using a double declining balance allocation.
            let a1UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[2]);
            assert.equal(a1UnclaimedReward.toString(), "95");
            assert.equal(a2UnclaimedReward.toString(), "285");
        });
    });

    describe("reward claiming", async () => {

        it("Should enable rewards to be claimed once reward epoch finalized", async () => {
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            // Assemble
            // stub ftso randomizer
            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
                ['address[]', 'uint256[]', 'uint256'],
                [[accounts[1], accounts[2]], [25, 75], 100]);
            await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
            // Stub accounting system to make it balance with RM contract

            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: fakeFlareKeeperAddress, to: ftsoRewardManager.address, value: 1000000 });

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));
            // Trigger price epoch finalization
            await ftsoManager.keep();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            // Trigger reward epoch finalization and another finalization
            await ftsoManager.keep();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });

            // Assert
            // a1 -> a3 claimed should be (100000000 / 262800) * 0.25 * 2 finalizations = 190
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), Math.floor(100000000 / 262800 * 0.25 * 2));
        });
    });
});
