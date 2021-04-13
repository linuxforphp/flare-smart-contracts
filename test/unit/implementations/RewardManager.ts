import { FtsoContract, FtsoInstance, FtsoManagerContract, FtsoManagerInstance, InflationMockContract, InflationMockInstance, MockContractContract, MockContractInstance, RewardManagerContract, RewardManagerInstance } from "../../../typechain-truffle";
import { revealSomePrices, RewardEpochData, setDefaultGovernanceParameters, settingWithFourFTSOs, settingWithOneFTSO_1, settingWithTwoFTSOs, submitSomePrices, toNumberify } from "../../utils/RewardManager-test-utils";
import { doBNListsMatch, lastOf, numberedKeyedObjectToList, toBN } from "../../utils/test-helpers";

const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const RewardManager = artifacts.require("RewardManager") as RewardManagerContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const Inflation = artifacts.require("InflationMock") as InflationMockContract;
const Ftso = artifacts.require("Ftso") as FtsoContract;
const MockFtso = artifacts.require("MockContract") as MockContractContract;

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const ERR_GOVERNANCE_ONLY = "only governance"
const ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "gov. params not initialized"

contract(`RewardManager.sol; ${ getTestFile(__filename) }; Reward manager unit tests`, async accounts => {
    // contains a fresh contract for each test
    let rewardManager: RewardManagerInstance;
    let ftsoManager: FtsoManagerInstance;
    let inflation: InflationMockInstance;
    let startTs: BN;
    let mockFtso: MockContractInstance;
    let ftsoInterface: FtsoInstance;

    beforeEach(async () => {
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
            // 172800,                      // Reward epoch 2 days
            // startTs
        );

        ftsoManager = await FtsoManager.new(
            accounts[0],
            rewardManager.address,
            PRICE_EPOCH_DURATION_S,
            startTs,
            REVEAL_EPOCH_DURATION_S,
            REWARD_EPOCH_DURATION_S,
            startTs,
            VOTE_POWER_BOUNDARY_FRACTION
        );
        await rewardManager.setFTSOManager(ftsoManager.address);
        await inflation.setRewardManager(rewardManager.address);
        await rewardManager.activate();
    });

    describe("basic", async () => {
        it("Should init price epoch start and not finalize anything", async () => {
            // Assemble
            await ftsoManager.activate();
            // Act
            let tx = await ftsoManager.keep();
            // Assert
            let data = await ftsoManager.getPriceEpochConfiguration() as any;
            assert(startTs.eq(data._firstPriceEpochStartTs));
            expectEvent.notEmitted(tx, "PriceEpochFinalized");
            expectEvent.notEmitted(tx, "RewardEpochFinalized");
        });
    });

    describe("FTSO initialization", async () => {
        it("Should sucessfully add an FTSO", async () => {
            // Assemble
            // Act
            await setDefaultGovernanceParameters(ftsoManager);
            let tx = await ftsoManager.addFtso(mockFtso.address);
            // Assert
            expectEvent(tx, "FtsoAdded");
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);
        });

        it("Should not add an FTSO if not from governance", async () => {
            // Assemble
            // Act
            let addPromise = ftsoManager.addFtso(mockFtso.address, { from: accounts[1] });
            // Assert
            expectRevert(addPromise, ERR_GOVERNANCE_ONLY);
        });

        it("Should not add FTSO if initial governance parameters not set", async () => {
            let [ftso1, _] = await settingWithTwoFTSOs(accounts, inflation, ftsoManager, rewardManager);
            // init reward epoch
            
            let addPromise = ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            expectRevert(addPromise, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);
        });

        it("Should governance set FTSO parameters to FTSO manager and then the FTSO manager set the FTSOs on init", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(
                accounts, inflation, ftsoManager, rewardManager, true
            );
            // init reward epoch
            let paramList = [0, 1e10 + 1, 1e10 + 2, 1, 1 + 2, 1000, 10001, 50];
            let paramListBN = paramList.map(x => toBN(x));

            // setup governance parameters
            await (ftsoManager.setGovernanceParameters as any)(...paramListBN, [ftso2,ftso3,ftso4].map(ftso => ftso.address));

            // add ftsos, parameters should be set by FTSOManager
            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso3.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso4.address, { from: accounts[0] });

            await ftsoManager.activate();
            // await ftsoManager.keep();

            let ftso1Params = numberedKeyedObjectToList<BN>(await ftso1.epochsConfiguration());
            let ftso2Params = numberedKeyedObjectToList<BN>(await ftso2.epochsConfiguration());
            let ftso3Params = numberedKeyedObjectToList<BN>(await ftso2.epochsConfiguration());
            let ftso4Params = numberedKeyedObjectToList<BN>(await ftso2.epochsConfiguration());

            // numeric epoch configuration should match the set one
            assert(doBNListsMatch(paramListBN, ftso1Params), "Wrong FTSO 1 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso2Params), "Wrong FTSO 2 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso3Params), "Wrong FTSO 3 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso4Params), "Wrong FTSO 4 governance parameters");

            // multiasset ftsos for ftso 1 should match
            assert.equal(await ftso1.fAssetFtsos(0), ftso2.address);
            assert.equal(await ftso1.fAssetFtsos(1), ftso3.address);
            assert.equal(await ftso1.fAssetFtsos(2), ftso4.address);

            // length of fAssetFtsos lists should match
            expectRevert.unspecified(ftso1.fAssetFtsos(3))
            expectRevert.unspecified(ftso2.fAssetFtsos(1))
            expectRevert.unspecified(ftso3.fAssetFtsos(1))
            expectRevert.unspecified(ftso4.fAssetFtsos(1))
        });

        it("Should governance set FTSO parameters after two price finalizations", async () => {
            let [ftso1, ftso2] = await settingWithTwoFTSOs(
                accounts, inflation, ftsoManager, rewardManager
            );
            // init reward epoch
            let defaultParamListBN = await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

            await ftsoManager.activate();
            await ftsoManager.keep();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 + 30));
            let tx = await ftsoManager.keep();

            // Assert
            expectEvent(tx, "PriceEpochFinalized");

            epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120 * 2));
            tx = await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 2 + 30));
            tx = await ftsoManager.keep();

            expectEvent(tx, "PriceEpochFinalized");

            epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            let paramList = [0, 1e10 + 1, 1e10 + 2, 1, 1 + 2, 1000, 10001, 50];
            let paramListBN = paramList.map(x => toBN(x));
            await (ftsoManager.setGovernanceParameters as any)(...paramListBN, []);

            await time.increaseTo(startTs.addn(120 * 3));
            tx = await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 3 + 30));
            tx = await ftsoManager.keep();

            expectEvent(tx, "PriceEpochFinalized");

            let ftso1Params = numberedKeyedObjectToList<BN>(await ftso1.epochsConfiguration());
            let ftso2Params = numberedKeyedObjectToList<BN>(await ftso2.epochsConfiguration());

            assert(doBNListsMatch(paramListBN, ftso1Params), "Wrong FTSO 1 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso2Params), "Wrong FTSO 2 governance parameters");
            assert(!doBNListsMatch(paramListBN, defaultParamListBN), "Changed parameters should not match the default ones.");
        });

    });

    describe("Price epochs, finalization", async () => {
        it("Should finalize a price epoch only", async () => {
            // Assemble
            await ftsoManager.activate();
            await ftsoManager.keep();  // initialize
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));
            // Act
            let tx = await ftsoManager.keep();
            // Assert
            expectEvent(tx, "PriceEpochFinalized");
            expectEvent.notEmitted(tx, "RewardEpochFinalized");
        });

        it("Should finalize a price epoch at the configured interval", async () => {
            // Assemble
            await ftsoManager.activate();
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120));
            await ftsoManager.keep();
            // Time travel another 120 seconds
            await time.increaseTo(startTs.addn(120 * 2));
            // Act
            let tx = await ftsoManager.keep();
            // Assert
            expectEvent(tx, "PriceEpochFinalized");
            expectEvent.notEmitted(tx, "RewardEpochFinalized");
        });

        it("Should finalize price epoch for winning ftso with no reward recipients", async () => {
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

            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.activate();

            await ftsoManager.keep();

            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte reward manager
            await ftsoManager.activate();
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            await ftsoManager.keep();

            // Assert
            let currentPriceEpoch = await ftsoManager.lastUnprocessedPriceEpoch();
            assert.equal(currentPriceEpoch.toNumber(), 1);
        });

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
            await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
            // set the daily reward amount
            await inflation.setRewardManagerDailyRewardAmount(1000000);

            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.activate();
            await ftsoManager.keep();

            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte reward manager

            await ftsoManager.activate();
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling reward manager
            await ftsoManager.keep();

            // Assert
            // a1 should be (1000000 / (86400 / 120)) * 0.25 = 347
            // a2 should be = (1000000 / (86400 / 120)) * 0.75 = 1041
            // TODO: There is a remainder of 0.8 repeating. It is not being allocated. Ok?
            let a1UnclaimedReward = await rewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[1]);
            let a2UnclaimedReward = await rewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[2]);
            assert.equal(a1UnclaimedReward.toNumber(), 347);
            assert.equal(a2UnclaimedReward.toNumber(), 1041);
        });

        it("Should finalize price epoch and declare non-winning but next eligible ftso the winner", async () => {
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
            await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });

            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.activate();
            await ftsoManager.keep();

            // set the daily reward amount
            await inflation.setRewardManagerDailyRewardAmount(1000000);
            // add fakey unrewardable ftso 0
            await ftsoManager.addFtso(mockFtsoNoAccounts.address, { from: accounts[0] });
            // add fakey rewardable ftso 1
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte reward manager
            await ftsoManager.activate();
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling reward manager
            await ftsoManager.keep();

            // Assert
            const { chosenFtso } = await ftsoManager.priceEpochs(0) as any;
            // Should equal FTOS 1, the next eligible ftso in the list
            assert.equal(chosenFtso, mockFtso.address);
        });

        it("Should force finalize the price after one finalization", async () => {
            let [ftso1, ftso2] = await settingWithTwoFTSOs(
                accounts, inflation, ftsoManager, rewardManager                
            );
            // init reward epoch
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

            await ftsoManager.activate();
            await ftsoManager.keep();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 + 30));
            let tx = await ftsoManager.keep();

            let ftso1Events = await ftso1.getPastEvents("PriceFinalized")
            let ftso2Events = await ftso2.getPastEvents("PriceFinalized")
            assert.equal(lastOf(ftso1Events).args.forced, false);
            assert.equal(lastOf(ftso2Events).args.forced, false);


            // reveal only for ftso2, not ftso1
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(2 * 120));
            await ftsoManager.keep();

            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(2 * 120 + 30));

            // finalize, ftso1 will force finalize
            await ftsoManager.keep();

            ftso1Events = await ftso1.getPastEvents("PriceFinalized");
            ftso2Events = await ftso2.getPastEvents("PriceFinalized");
            assert.equal(lastOf(ftso1Events).args.forced, true);
            assert.equal(lastOf(ftso2Events).args.forced, false);

        });

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

        await ftsoManager.activate();
        await ftsoManager.keep();
        // add fakey ftso
        await ftsoManager.addFtso(mockFtso.address, {from: accounts[0]});
        // activate reward manager so keeper can fire events
        await ftsoManager.activate();

        // Act
        for (var i = 1; i <= (172800 / 1200); i++) {
            // Time travel to trigger a price epoch change
            // Cheat and do every 20 mins to reduce test time
            await time.increaseTo(startTs.addn(1200 * i));
            // Mine at least a block
            await time.advanceBlock();
            await ftsoManager.keep();            
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
        console.log("XXX-4")
        // Should be 2 invocations; 1 during FTSO init, 1 during FTSO finalize - for 1 FTSO
        assert.equal(invocationCount.toNumber(), 2);
        // Should be 1 call setting vote power block 522 for ftso[0]
        assert.equal(invocationCountToFinalize.toNumber(), 1);
    });
    */
    describe("Reward epochs, finalization", async () => {

        it("Should finalize a reward epoch", async () => {
            // Assemble
            await ftsoManager.activate();
            ftsoManager.keep();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            // Act
            let tx = await ftsoManager.keep();
            // // Assert
            expectEvent(tx, "RewardEpochFinalized");
        });

        it("Should finalize a reward epoch at the configured interval", async () => {
            // Assemble
            await ftsoManager.activate();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            await ftsoManager.keep();
            // Time travel another 2 days
            await time.increaseTo(startTs.addn(172800 * 2));
            // Act
            let tx = await ftsoManager.keep();
            // Assert
            expectEvent(tx, "RewardEpochFinalized");
        });

        it("Should setup a reward epoch when initial startup time passes", async () => {
            // Assemble
            // Store block numbers
            const b = [];
            await ftsoManager.activate();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            await time.advanceBlock();
            b[0] = await web3.eth.getBlockNumber();
            // Act
            // Force another block
            await ftsoManager.keep();
            // Assert
            const { votepowerBlock, startBlock } = await ftsoManager.rewardEpochs(0) as any;
            assert.equal(votepowerBlock.toNumber(), b[0]);
            assert.equal(startBlock.toNumber(), b[0] + 1);
        });

        it("Should select vote power block in the correct interval and be random", async () => {
            await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, inflation, ftsoManager, rewardManager);
            ftsoManager.keep();
            let b: number[] = [];
            let rewardEpochDataList: any[] = [];
            let currentSnapshotTime = startTs.addn(REWARD_EPOCH_DURATION_S)
            await time.increaseTo(currentSnapshotTime);
            await time.advanceBlock();

            b[0] = await web3.eth.getBlockNumber();
            // Act
            await ftsoManager.keep();
            let secondsPerBlock = 60 * 60 * 6;
            let noRuns = 5;
            for (let i = 0; i < noRuns; i++) {
                let res = toNumberify(await ftsoManager.rewardEpochs(i) as any as RewardEpochData) as any;
                rewardEpochDataList.push(res);
                for (let j = 0; j < REWARD_EPOCH_DURATION_S; j += secondsPerBlock) {
                    currentSnapshotTime = currentSnapshotTime.addn(secondsPerBlock);
                    await time.increaseTo(currentSnapshotTime);
                    await time.advanceBlock();
                    await ftsoManager.keep();
                }
            }
            let offsets = new Set<number>();
            for (let i = 1; i < rewardEpochDataList.length; i++) {
                rewardEpochDataList[i].diff = rewardEpochDataList[i].startBlock - rewardEpochDataList[i - 1].startBlock;
                rewardEpochDataList[i].offset = rewardEpochDataList[i].startBlock - rewardEpochDataList[i].votepowerBlock;
                rewardEpochDataList[i].min = rewardEpochDataList[i].startBlock - Math.floor(rewardEpochDataList[i].diff / VOTE_POWER_BOUNDARY_FRACTION);
                offsets.add(rewardEpochDataList[i].offset);
                assert(rewardEpochDataList[i].votepowerBlock >= rewardEpochDataList[i].min, "Vote power block in wrong range.");
            }
            // console.log(rewardEpochDataList)
            assert(offsets.size > 1, "Offsets not random (ok to fail with small probability)");
        });
    });

    describe("reward claiming", async () => {
        it("Should accept FLR", async () => {
            // Assemble
            // Act
            await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(rewardManager.address));
            assert.equal(balance.toNumber(), 1000000);
        });

        it("Should enable rewards to be claimed once reward epoch finalized", async () => {
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
            await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
            await inflation.setRewardManagerDailyRewardAmount(1000000);

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte reward manager
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
            await rewardManager.claimReward(accounts[3], 0, { from: accounts[1] });

            // Assert
            // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 * 2 finalizations = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), Math.floor(1000000 / (86400 / 120) * 0.25 * 2));
        });

    });

});
