import {
    FtsoInstance,
    FtsoManagerInstance,
    MockContractInstance,
    FtsoRewardManagerInstance,
    WFlrInstance,
    InflationMockInstance
} from "../../../typechain-truffle";

import { setDefaultGovernanceParameters } from "../../utils/FtsoManager-test-utils";

const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const FtsoManager = artifacts.require("FtsoManager");
const Ftso = artifacts.require("Ftso");
const MockContract = artifacts.require("MockContract");
const WFLR = artifacts.require("WFlr");
const InflationMock = artifacts.require("InflationMock");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`RewardManager.sol and FtsoManager.sol; ${ getTestFile(__filename) }; Reward manager and Ftso manager integration tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let ftsoManager: FtsoManagerInstance;
    let startTs: BN;
    let mockFtso: MockContractInstance;
    let ftsoInterface: FtsoInstance;
    let wFlr: WFlrInstance;
    let fakeFlareKeeperAddress = accounts[1];
    let mockInflation: InflationMockInstance;
    let mockSupply: MockContractInstance;

    beforeEach(async () => {
        mockFtso = await MockContract.new();
        mockSupply = await MockContract.new();
        ftsoInterface = await Ftso.new(
            "FLR",
            constants.ZERO_ADDRESS as any,
            constants.ZERO_ADDRESS as any,
            0
        );

        mockInflation = await InflationMock.new();

        ftsoRewardManager = await FtsoRewardManager.new(
            accounts[0],
            3,
            0,
            100,
            mockInflation.address,
            mockSupply.address
        );

        await mockInflation.setInflationReceiver(ftsoRewardManager.address);
        await mockInflation.setDailyAuthorizedInflation(BN(1000000));
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoManager = await FtsoManager.new(
            accounts[0],
            accounts[0],
            ftsoRewardManager.address,
            accounts[7],
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
            await mockInflation.receiveInflation({ value: "1000000" } );

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });

            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            // Time travel over the price epoch plus the reveal
            await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));

            // Act
            // Simulate the keeper tickling ftso manager to finalize the price epoch
            await ftsoManager.keep();

            // Assert
            // a1 should be (1000000 / 720) * 0.25 = 347
            // a2 should be = (1000000 / 720) * 0.75 = 1041
            // There is a remainder. It is not being allocated. It should get progressively
            // smaller using a double declining balance allocation.
            let a1UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[2]);
            assert.equal(a1UnclaimedReward.toString(), "347");
            assert.equal(a2UnclaimedReward.toString(), "1041");
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
            await mockInflation.receiveInflation({ value: "1000000" } );

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();
            // Time travel to price epoch finalization time
            await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S));
            // Trigger price epoch finalization
            await ftsoManager.keep();
            // Time travel to reward epoch finalizaion time
            await time.increaseTo(startTs.addn(REWARD_EPOCH_DURATION_S));
            // Trigger reward epoch finalization and another finalization
            await ftsoManager.keep();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });

            // Assert
            // a1 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 finalizations = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), Math.floor(1000000 / 720 * 0.25 * 2));
        });
    });
});
