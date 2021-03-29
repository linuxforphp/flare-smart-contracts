const {deployMockContract} = require("@ethereum-waffle/mock-contract");
const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const RewardManager = artifacts.require("RewardManager");
const Inflation = artifacts.require("InflationMock");
const Ftso = artifacts.require("Ftso");
const MockFtso = artifacts.require("MockContract");

async function timeIncreaseTo (seconds) {
    const delay = 1000 - new Date().getMilliseconds();
    await new Promise(resolve => setTimeout(resolve, delay));
    await time.increaseTo(seconds);
}

// TODO: OK, I tried really hard to write this in TS, BUT OZ helpers, which are very helpful to
// advance time and blocks, do not have TS bindings. See: 
// https://github.com/OpenZeppelin/openzeppelin-test-helpers/pull/141/checks?check_run_id=1415297312
// Back to Javascript...

contract(`RewardManager.sol; ${getTestFile(__filename)}; Reward manager unit tests`, async accounts => {
    // contains a fresh contract for each test
    let rewardManager;
    let inflation;
    let startTs;
    let mockFtso;
    let ftsoInterface;

    beforeEach(async() => {
        mockFtso = await MockFtso.new();
        inflation = await Inflation.new();
        ftsoInterface = await Ftso.new(
            0,
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS
        );

        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        rewardManager = await RewardManager.new(
            accounts[0],
            inflation.address,
            172800,                      // Reward epoch 2 days
            120,                         // Price epoch 2 minutes
            startTs,
            startTs
        );
        await inflation.setRewardManager(rewardManager.address);
    });

    it("Should init price epoch start and not finalize anything", async() => {
        // Assemble
        await rewardManager.activate();
        // Act
        let tx = await rewardManager.keep();
        // Assert
        assert(startTs.eq(await rewardManager.firstPriceEpochStartTs()));
        expectEvent.notEmitted(tx, "PriceEpochFinalized");
        expectEvent.notEmitted(tx, "RewardEpochFinalized");
    });

    it("Should finalize a price epoch only", async() => {
        // Assemble
        await rewardManager.activate();
        // Time travel 120 seconds
        await time.increaseTo(startTs.addn(120));
        // Act
        let tx = await rewardManager.keep();
        // Assert
        expectEvent(tx, "PriceEpochFinalized");
        expectEvent.notEmitted(tx, "RewardEpochFinalized");
    });

    it("Should finalize a price epoch at the configured interval", async() => {
        // Assemble
        await rewardManager.activate();
        // Time travel 120 seconds
        await time.increaseTo(startTs.addn(120));
        await rewardManager.keep();
        // Time travel another 120 seconds
        await time.increaseTo(startTs.addn(120 * 2));
        // Act
        let tx = await rewardManager.keep();
        // Assert
        expectEvent(tx, "PriceEpochFinalized");
        expectEvent.notEmitted(tx, "RewardEpochFinalized");
    });

    it("Should finalize a reward epoch", async() => {
        // Assemble
        await rewardManager.activate();
        // Time travel 120 seconds
        await time.increaseTo(startTs.addn(172800));
        // Act
        let tx = await rewardManager.keep();
        // Assert
        expectEvent(tx, "RewardEpochFinalized");
    });

    it("Should finalize a reward epoch at the configured interval", async() => {
        // Assemble
        await rewardManager.activate();
        // Time travel 2 days
        await time.increaseTo(startTs.addn(172800));
        await rewardManager.keep();
        // Time travel another 2 days
        await time.increaseTo(startTs.addn(172800 * 2));
        // Act
        let tx = await rewardManager.keep();
        // Assert
        expectEvent(tx, "RewardEpochFinalized");
    });

    it("Should sucessfully add an FTSO", async() => {
        // Assemble
        // Act
        let tx = await rewardManager.addFtso(mockFtso.address);
        // Assert
        expectEvent(tx, "FtsoAdded");
        assert.equal(mockFtso.address, await rewardManager.ftsos(0));
    });

    it("Should not add an FTSO if not from governance", async() => {
        // Assemble
        // Act
        let addPromise = rewardManager.addFtso(mockFtso.address, {from: accounts[1]});
        // Assert
        expectRevert(addPromise, "only governance");
    });

    it("Should finalize price epoch for winning ftso with no reward recipients", async() => {
        // Assemble
        // stub randomizer
        const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
        await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
        // stub finalizer
        const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
        const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'], 
        [[], [], '0']);
        await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
    
        // add fakey ftso
        await rewardManager.addFtso(mockFtso.address, {from: accounts[0]});
        // activte reward manager
        await rewardManager.activate();
        // Time travel 120 seconds
        await time.increaseTo(startTs.addn(120));

        // Act
        await rewardManager.keep();

        // Assert
        let currentPriceEpoch = await rewardManager.currentPriceEpoch();
        assert.equal(currentPriceEpoch.toNumber(), 1);
    });

    it("Should finalize price epoch and distribute unclaimed rewards", async() => {
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
        // set the daily reward amount
        await inflation.setRewardManagerDailyRewardAmount(1000000);

        // add fakey ftso
        await rewardManager.addFtso(mockFtso.address, {from: accounts[0]});
        // activte reward manager
        await rewardManager.activate();
        // Time travel 120 seconds
        await time.increaseTo(startTs.addn(120));

        // Act
        // Simulate the keeper tickling reward manager
        await rewardManager.keep();

        // Assert
        // a1 should be (1000000 / (86400 / 120)) * 0.25 = 347
        // a2 should be = (1000000 / (86400 / 120)) * 0.75 = 1041
        // TODO: There is a remainder of 0.8 repeating. It is not being allocated. Ok?
        let a1UnclaimedReward = await rewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[1]);
        let a2UnclaimedReward = await rewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[2]);
        assert.equal(a1UnclaimedReward.toNumber(), 347);
        assert.equal(a2UnclaimedReward.toNumber(), 1041);
    });

    it("Should finalize price epoch and declare non-winning but next eligible ftso the winner", async() => {
        // Assemble
        // Force the first FTSO random number generator to yield FTSO 0 as reward FTSO
        const mockFtsoNoAccounts = await MockFtso.new();
        const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
        await mockFtsoNoAccounts.givenMethodReturnUint(getCurrentRandom, 0);
        // Rig FTSO0 to yield no accounts
        const finalizePriceEpochFtso0 = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
        const finalizePriceEpochReturnFtso0 = web3.eth.abi.encodeParameters(
            ['address[]', 'uint256[]', 'uint256'], 
            [[], [], 100]);
        await mockFtsoNoAccounts.givenMethodReturn(finalizePriceEpochFtso0, finalizePriceEpochReturnFtso0);
        // stub FTSO1 to actually contain rewardable accounts
        const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
        const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'], 
        [[accounts[1], accounts[2]], [25, 75], 100]);
        await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
        // set the daily reward amount
        await inflation.setRewardManagerDailyRewardAmount(1000000);
        // add fakey unrewardable ftso 0
        await rewardManager.addFtso(mockFtsoNoAccounts.address, {from: accounts[0]});
        // add fakey rewardable ftso 1
        await rewardManager.addFtso(mockFtso.address, {from: accounts[0]});
        // activte reward manager
        await rewardManager.activate();
        // Time travel 120 seconds
        await time.increaseTo(startTs.addn(120));

        // Act
        // Simulate the keeper tickling reward manager
        await rewardManager.keep();

        // Assert
        const {chosenFtso} = await rewardManager.priceEpochs(0);
        // Should equal FTOS 1, the next eligible ftso in the list
        assert.equal(chosenFtso, mockFtso.address);
    });
});
