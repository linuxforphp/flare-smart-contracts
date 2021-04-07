import { FtsoContract, FtsoInstance, InflationMockContract, InflationMockInstance, MockContractContract, MockContractInstance, RewardManagerContract, RewardManagerInstance } from "../../../typechain-truffle";

const {deployMockContract} = require("@ethereum-waffle/mock-contract");
const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const RewardManager = artifacts.require("RewardManager") as RewardManagerContract;
const Inflation = artifacts.require("InflationMock") as InflationMockContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const MockFtso = artifacts.require("MockContract") as MockContractContract;

contract(`RewardManager.sol; ${getTestFile(__filename)}; Reward manager unit tests`, async accounts => {
    // contains a fresh contract for each test
    let rewardManager: RewardManagerInstance;
    let inflation: InflationMockInstance;
    let startTs: BN;
    let mockFtso: MockContractInstance;
    let ftsoInterface: FtsoInstance;

    beforeEach(async() => {
        mockFtso = await MockFtso.new();
        inflation = await Inflation.new();
        ftsoInterface = await Ftso.new(
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS as any,
            constants.ZERO_ADDRESS as any
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
        // Time travel 2 days
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

        // give reward manager some flr to distribute
        await web3.eth.sendTransaction({from: accounts[0], to: rewardManager.address, value: 1000000});
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
        // give reward manager some flr to distribute
        await web3.eth.sendTransaction({from: accounts[0], to: rewardManager.address, value: 1000000});
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
        const {chosenFtso} = await rewardManager.priceEpochs(0) as any;
        // Should equal FTOS 1, the next eligible ftso in the list
        assert.equal(chosenFtso, mockFtso.address);
    });

    it("Should setup a reward epoch when initial startup time passes", async() => {
        // Assemble
        // Store block numbers
        const b = [];
        await rewardManager.activate();
        // Time travel 2 days
        await time.increaseTo(startTs.addn(172800));
        await time.advanceBlock();
        b[0] = await web3.eth.getBlockNumber();
        // Act
        // Force another block
        await rewardManager.keep();
        // Assert
        const {votepowerBlock, startBlock} = await rewardManager.rewardEpochs(0) as any;
        assert.equal(votepowerBlock.toNumber(), b[0]);
        assert.equal(startBlock.toNumber(), b[0] + 1);
    });

    /** TODO: This needs block.number mocking to make this work consistently.
    it("Should finalize a reward epoch and designate a new vote power block, setting FTSOs to new block", async() => {
        // Assemble
        // Store block numbers
        const b = [];
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
        // activate reward manager so keeper can fire events
        await rewardManager.activate();

        // Act
        for (var i = 1; i <= (172800 / 1200); i++) {
            // Time travel to trigger a price epoch change
            // Cheat and do every 20 mins to reduce test time
            await time.increaseTo(startTs.addn(1200 * i));
            // Mine at least a block
            await time.advanceBlock();
            await rewardManager.keep();
        }

        // Assert

        // Here are calculated intermediate values leading to the values below.
        // So long as blockchain time is started at 1/1/2021 00:00 (set in hardhat.config.ts), 
        // these values SHOULD be consistent across runs and development systems (need confirmation).
        // getFreshRandom: 0
        // blockTimeStamp: 1610352789
        // lastRandom: 33477408647911858043435212757800905465596441501019447121012751689213337316928
        // votepowerBlockBoundary: 61
        // startBlock 674
        // votepowerBlock: 613

        // Get the new reward epoch
        const {votepowerBlock, startBlock} = await rewardManager.rewardEpochs(1) as any;
        const VOTEPOWERBLOCK = 613;
        const STARTBLOCK = 674;
        assert.equal(votepowerBlock.toNumber(), VOTEPOWERBLOCK);
        assert.equal(startBlock.toNumber(), STARTBLOCK);

        // Get the invocation count for setting new vote power block on mocked FTSO
        const setVotePowerBlock = ftsoInterface.contract.methods.setVotePowerBlock(VOTEPOWERBLOCK).encodeABI();
        const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
        const invocationCountToFinalize = await mockFtso.invocationCountForCalldata.call(setVotePowerBlock);
        // Should be 2 invocations; 1 during FTSO init, 1 during FTSO finalize - for 1 FTSO
        assert.equal(invocationCount.toNumber(), 2);
        // Should be 1 call setting vote power block 522 for ftso[0]
        assert.equal(invocationCountToFinalize.toNumber(), 1);
    });
    */

    it("Should accept FLR", async() => {
        // Assemble
        // Act
        await web3.eth.sendTransaction({from: accounts[0], to: rewardManager.address, value: 1000000});
        // Assert
        let balance = web3.utils.toBN(await web3.eth.getBalance(rewardManager.address));
        assert.equal(balance.toNumber(), 1000000);
    });

    it("Should enable rewards to be claimed once reward epoch finalized", async() => {
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
        await web3.eth.sendTransaction({from: accounts[0], to: rewardManager.address, value: 1000000});
        await inflation.setRewardManagerDailyRewardAmount(1000000);

        // add fakey ftso
        await rewardManager.addFtso(mockFtso.address, {from: accounts[0]});
        // activte reward manager
        await rewardManager.activate();
        // Time travel 120 seconds
        await time.increaseTo(startTs.addn(120));
        // Trigger price epoch finalization
        await rewardManager.keep();
        // Time travel 2 days
        await time.increaseTo(startTs.addn(172800));
        // Trigger reward epoch finalization
        await rewardManager.keep();

        // Act
        // Claim reward to a3 - test both 3rd party claim and avoid
        // having to calc gas fees
        let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
        await rewardManager.claimReward(accounts[3], 0, {from: accounts[1]});

        // Assert
        // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 = 347
        let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
        assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);
    });
});
