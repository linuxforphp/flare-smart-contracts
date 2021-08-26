import {
    CleanupBlockNumberManagerInstance,
    FtsoInstance,
    FtsoManagerInstance,
    FtsoRegistryInstance,
    FtsoRewardManagerInstance, MockContractInstance,
    MockVPTokenContract,
    MockVPTokenInstance
} from "../../../../typechain-truffle";
import {
    revealSomePrices,
    RewardEpochData,
    setDefaultGovernanceParameters,
    settingWithFourFTSOs,
    settingWithOneFTSO_1,
    settingWithTwoFTSOs,
    submitSomePrices,
    toNumberify
} from "../../../utils/FtsoManager-test-utils";
import { compareArrays, doBNListsMatch, lastOf, numberedKeyedObjectToList, toBN } from "../../../utils/test-helpers";


import { constants, expectRevert, expectEvent, time } from '@openzeppelin/test-helpers';
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
const getTestFile = require('../../../utils/constants').getTestFile;

const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const FtsoManager = artifacts.require("FtsoManager");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const Ftso = artifacts.require("Ftso");
const MockFtso = artifacts.require("MockContract");
const MockContract = artifacts.require("MockContract");
const PriceSubmitter = artifacts.require("PriceSubmitter");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const ERR_GOVERNANCE_ONLY = "only governance"
const ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "Gov. params not initialized"
const ERR_FASSET_FTSO_NOT_MANAGED = "FAsset FTSO not managed by ftso manager";
const ERR_NOT_FOUND = "FTSO index not supported";
const ERR_FTSO_SYMBOLS_MUST_MATCH = "FTSO symbols must match";

const DAY = 60*60*24;


contract(`FtsoManager.sol; ${ getTestFile(__filename) }; Ftso manager unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoManager: FtsoManagerInstance;
    let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;
    let startTs: BN;
    let mockRewardManager: MockContractInstance;
    let ftsoRewardManagerInterface: FtsoRewardManagerInstance;
    let mockFtso: MockContractInstance;
    let ftsoInterface: FtsoInstance;
    let ftsoRegistry: FtsoRegistryInstance;
    let mockPriceSubmitter: MockContractInstance;
    let mockVoterWhitelister: MockContractInstance;

    async function mockFtsoSymbol(symbol: string, mockContract: MockContractInstance, dummyInterface: FtsoInstance){        
        const encodedMethod = dummyInterface.contract.methods.symbol().encodeABI();
        const symbolReturn = web3.eth.abi.encodeParameter('string', symbol);
        await mockContract.givenMethodReturn(encodedMethod, symbolReturn);
    }


    beforeEach(async () => {
        mockFtso = await MockFtso.new();
        ftsoInterface = await Ftso.new(
            "FLR",
            constants.ZERO_ADDRESS as any,
            constants.ZERO_ADDRESS as any,
            constants.ZERO_ADDRESS as any,
            0,
            1e10,
            defaultPriceEpochCyclicBufferSize
        );

        await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
        
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        mockRewardManager = await MockContract.new();
        ftsoRewardManagerInterface = await FtsoRewardManager.new(
            accounts[0],
            3,
            0,
            (await MockContract.new()).address
        );

        ftsoRegistry = await FtsoRegistry.new(accounts[0]);
        
        mockPriceSubmitter = await MockContract.new();
        await mockPriceSubmitter.givenMethodReturnUint(
            web3.utils.sha3("addFtso(address)")!.slice(0,10),
            0
        )
        await mockPriceSubmitter.givenMethodReturnUint(
            web3.utils.sha3("removeFtso(address)")!.slice(0,10),
            0
        )
        mockVoterWhitelister = await MockContract.new();

        ftsoManager = await FtsoManager.new(
            accounts[0],
            accounts[0],
            mockRewardManager.address,
            mockPriceSubmitter.address,
            ftsoRegistry.address,
            mockVoterWhitelister.address,
            PRICE_EPOCH_DURATION_S,
            startTs,
            REVEAL_EPOCH_DURATION_S,
            REWARD_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            VOTE_POWER_BOUNDARY_FRACTION
        );

        cleanupBlockNumberManager = await CleanupBlockNumberManager.new(accounts[0]);

        await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address, {from: accounts[0]});

    });

    describe("basic", async () => {
        it("Should revert at deploy if setting invalid parameters", async () => {
            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                0,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs.addn(REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Price epoch 0");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                0,
                REWARD_EPOCH_DURATION_S,
                startTs.addn(REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reveal price epoch 0");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                0,
                startTs.addn(REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reward epoch 0");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs.addn(500),
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs.addn(REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "First epoch start timestamp in future");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                PRICE_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs.addn(REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reveal price epoch too long");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs.subn(1),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reward epoch start too soon");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs.addn(REVEAL_EPOCH_DURATION_S + 1),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reward epoch start condition invalid");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S + 1,
                startTs.addn(REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reward epoch duration condition invalid");
        });

        it("Should return price submitter address", async () => {
            expect(await ftsoManager.getPriceSubmitter()).to.equals(mockPriceSubmitter.address);
        });

        it("Should return true when calling daemonize and ftso manager is active", async () => {
            await ftsoManager.activate();
            expect(await ftsoManager.daemonize.call()).to.equals(true);
        });

        it("Should return false when calling daemonize and ftso manager not active", async () => {
            expect(await ftsoManager.daemonize.call()).to.equals(false);
        });
        
        it("Should revert calling daemonize if not from flare daemon", async () => {
            await ftsoManager.activate();
            await expectRevert(ftsoManager.daemonize({ from : accounts[1]}), "only flare daemon");
        });

        it("Should get current price epoch data", async () => {
            let epochId = Math.floor(((await time.latest()).toNumber() - startTs.toNumber()) / PRICE_EPOCH_DURATION_S);
            let data = await ftsoManager.getCurrentPriceEpochData();
            expect(data[0].toNumber()).to.equals(epochId);
            let startTime = startTs.toNumber() + epochId * PRICE_EPOCH_DURATION_S;
            expect(data[1].toNumber()).to.equals(startTime);
            expect(data[2].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S);
            expect(data[3].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S);

            await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S));
            epochId++;

            data = await ftsoManager.getCurrentPriceEpochData();
            expect(data[0].toNumber()).to.equals(epochId);
            startTime = startTs.toNumber() + epochId * PRICE_EPOCH_DURATION_S;
            expect(data[1].toNumber()).to.equals(startTime);
            expect(data[2].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S);
            expect(data[3].toNumber()).to.equals(startTime + PRICE_EPOCH_DURATION_S + REVEAL_EPOCH_DURATION_S);
        });

        it("Should get current reward epoch", async () => {
            await expectRevert(ftsoManager.getCurrentRewardEpoch(), "Reward epoch not initialized yet");

            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initalize reward epoch
            expect((await ftsoManager.getCurrentRewardEpoch()).toNumber()).to.equals(0);
            
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S));
            await ftsoManager.daemonize();

            expect((await ftsoManager.getCurrentRewardEpoch()).toNumber()).to.equals(1);
        });

        it("Should get reward epoch vote power block", async () => {
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();

            let block = await web3.eth.getBlockNumber();

            expect((await ftsoManager.getRewardEpochVotePowerBlock(0)).toNumber()).to.equals(block-1);
        });

        it("Should not set governance paramters if not from governance", async () => {
            await expectRevert(ftsoManager.setGovernanceParameters(5, 5, 50, 500, 500, 5000, 10*DAY,[], { from: accounts[2] }), "only governance");
        });

        it("Should not set governance paramters if not from governance", async () => {
            await expectRevert(ftsoManager.setGovernanceParameters(5, 5, 50, 500, 500, 5000, 10*DAY,[], { from: accounts[2] }), "only governance");
        });

        it("Should revert setting invalid governance parameters", async () => {
            await expectRevert(ftsoManager.setGovernanceParameters(0, 5, 50, 500, 500, 5000, 10*DAY, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(5, 0, 50, 500, 500, 5000, 10*DAY, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(5, 5, 500, 50, 500, 5000, 10*DAY, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(5, 5, 50, 500, 50000, 5000, 10*DAY, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(5, 5, 50, 500, 500, 50000, 10*DAY, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(5, 5, 50, 500, 500, 5000, 0, []), "Reward expiry invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(5, 5, 50, 500, 500, 5000, 10*DAY, [accounts[0], accounts[1], accounts[2], accounts[3], accounts[4], accounts[5]]), "Max trusted addresses length exceeded");
        });

        it("Should activate", async () => {
            await ftsoManager.activate();
        });

        it("Should not activate if not from governance", async () => {
            await expectRevert(ftsoManager.activate({ from: accounts[2] }), "only governance");
        });

        it("Should init price epoch start and not finalize anything", async () => {
            // Assemble
            await ftsoManager.activate();
            // Act
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            let tx = await ftsoManager.daemonize();
            // Assert
            let data = await ftsoManager.getPriceEpochConfiguration() as any;
            assert(startTs.eq(data._firstPriceEpochStartTs));
            expectEvent.notEmitted(tx, "PriceEpochFinalized");
            expectEvent.notEmitted(tx, "RewardEpochFinalized");
        });
    });

    describe("FTSO initialization", async () => {
        it("Should successfully add an FTSO", async () => {
            // Assemble
            // Act
            await setDefaultGovernanceParameters(ftsoManager);
            let tx = await ftsoManager.addFtso(mockFtso.address);
            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: true});
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);

            const activate = web3.utils.sha3("activateFtso(address,uint256,uint256,uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(activate);
            assert.equal(invocationCount.toNumber(), 1);

            const configureEpochs = web3.utils.sha3("configureEpochs(uint256,uint256,uint256,uint256,uint256,uint256,address[])")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount2 = await mockFtso.invocationCountForMethod.call(configureEpochs);
            assert.equal(invocationCount2.toNumber(), 1);

            const addFtsoVoterWhitelister = web3.utils.sha3("addFtso(uint256)")!.slice(0, 10); // first 4 bytes is function selector
            const voterWhitelisterInvocationCount = await mockVoterWhitelister.invocationCountForMethod.call(addFtsoVoterWhitelister);
            // should add new ftso to VoterWhitelister
            assert.equal(voterWhitelisterInvocationCount.toNumber(), 1);
        });

        it("Should not add an FTSO twice", async () => {
            // Assemble
            // Act
            await setDefaultGovernanceParameters(ftsoManager);
            let tx = await ftsoManager.addFtso(mockFtso.address);
            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: true});
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);

            await expectRevert(ftsoManager.addFtso(mockFtso.address), "Already added");
        });

        it("Should initialize reward epoch only after reward epoch start timestamp", async () => {
            mockPriceSubmitter = await MockContract.new();
            await mockPriceSubmitter.givenMethodReturnUint(
                web3.utils.sha3("addFtso(address)")!.slice(0,10),
                0
            )

            ftsoManager = await FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                mockPriceSubmitter.address,
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs.addn(PRICE_EPOCH_DURATION_S * 5 + REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION
            );
            
            await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address, {from: accounts[0]});

            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
            ['address[]', 'uint256[]', 'uint256'], 
            [[], [], '0']);
            await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, {from: accounts[0]});
            await ftsoManager.activate();
            await ftsoManager.daemonize();
            
            // Get the invocation count for setting new vote power block on mocked FTSO
            const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0,10); // first 4 bytes is function selector
            // Act
            for (var i = 1; i < 10; i++) {
                // Time travel to trigger a first initialize reward epoch
                // Cheat and do every 50 seconds to reduce test time
                await time.increaseTo(startTs.addn(60 * i));
                // Mine at least a block
                await time.advanceBlock();
                await ftsoManager.daemonize();
                const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
                assert.equal(invocationCount.toNumber(), 0);
            }

            // Assert
            await time.increaseTo(startTs.addn(PRICE_EPOCH_DURATION_S * 5 + REVEAL_EPOCH_DURATION_S));
            await time.advanceBlock();
            await ftsoManager.daemonize();
            const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
            // Should be 1 invocation during initializing first reward epoch - for 1 FTSO
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should successfully add an FTSO even if ftso manager is active", async () => {
            // Assemble
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();
            await setDefaultGovernanceParameters(ftsoManager);
            
            // Act
            let tx = await ftsoManager.addFtso(mockFtso.address);
            
            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: true});
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);
            
            const activate = web3.utils.sha3("activateFtso(address,uint256,uint256,uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(activate);
            assert.equal(invocationCount.toNumber(), 1);

            const configureEpochs = web3.utils.sha3("configureEpochs(uint256,uint256,uint256,uint256,uint256,uint256,address[])")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount2 = await mockFtso.invocationCountForMethod.call(configureEpochs);
            assert.equal(invocationCount2.toNumber(), 1);
            
            const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount3 = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
            assert.equal(invocationCount3.toNumber(), 1);
        });

        it("Should not add an FTSO if not from governance", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            // Act
            let addPromise = ftsoManager.addFtso(mockFtso.address, { from: accounts[1] });
            // Assert
            await expectRevert(addPromise, ERR_GOVERNANCE_ONLY);
        });

        it("Should successfully remove an FTSO", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            let tx = await ftsoManager.addFtso(mockFtso.address);
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: true});
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);
            
            // Act
            let tx2 = await ftsoManager.removeFtso(mockFtso.address);

            // Assert
            expectEvent(tx2, "FtsoAdded", {ftso: mockFtso.address, add: false});
            assert.equal((await ftsoManager.getFtsos()).length, 0);
            const deactivate = web3.utils.sha3("deactivateFtso()")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(deactivate);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should revert at removing an FTSO if not managed", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            
            // Act
            let removePromise = ftsoManager.removeFtso(mockFtso.address);

            // Assert
            await expectRevert(removePromise, ERR_NOT_FOUND);
        });

        it("Should not remove an FTSO if not from governance", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            let tx = await ftsoManager.addFtso(mockFtso.address);
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: true});
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);
            
            // Act
            let removePromise = ftsoManager.removeFtso(mockFtso.address, { from: accounts[1] });

            // Assert
            await expectRevert(removePromise, ERR_GOVERNANCE_ONLY);
        });

        it("Should successfully replace an FTSO and not update initial price", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(mockFtso.address);
            let mockFtso2 = await MockFtso.new();

            const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
            const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
            await mockFtso.givenMethodReturn(symbol, symbolReturn);
            await mockFtso2.givenMethodReturn(symbol, symbolReturn);
            
            const currentPrice = ftsoInterface.contract.methods.getCurrentPrice().encodeABI();
            const currentPriceReturn = web3.eth.abi.encodeParameters(['uint256','uint256'], [500, 1]);
            await mockFtso.givenMethodReturn(currentPrice, currentPriceReturn);

            let addFtsoVoterWhitelister = web3.utils.sha3("addFtso(uint256)")!.slice(0, 10); // first 4 bytes is function selector
            let voterWhitelisterInvocationCount = await mockVoterWhitelister.invocationCountForMethod.call(addFtsoVoterWhitelister);
            // should add new ftso to VoterWhitelister
            assert.equal(voterWhitelisterInvocationCount.toNumber(), 1);

            // Act
            let tx = await ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, false, false);

            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: false});
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso2.address, add: true});
            assert.equal((await ftsoManager.getFtsos()).length, 1);

            const updateInitialPrice = web3.utils.sha3("updateInitialPrice(uint256,uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(updateInitialPrice);
            assert.equal(invocationCount.toNumber(), 0);

            addFtsoVoterWhitelister = web3.utils.sha3("addFtso(uint256)")!.slice(0, 10); // first 4 bytes is function selector
            voterWhitelisterInvocationCount = await mockVoterWhitelister.invocationCountForMethod.call(addFtsoVoterWhitelister);
            // should not add new ftso to VoterWhitelister
            assert.equal(voterWhitelisterInvocationCount.toNumber(), 1);
        });

        it("Should successfully replace an FTSO and update initial price", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(mockFtso.address);
            let mockFtso2 = await MockFtso.new();

            await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
            await mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

            const currentPrice = ftsoInterface.contract.methods.getCurrentPrice().encodeABI();
            const currentPriceReturn = web3.eth.abi.encodeParameters(['uint256','uint256'], [500, 1]);
            await mockFtso.givenMethodReturn(currentPrice, currentPriceReturn);

            // Act
            let tx = await ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, true, false);

            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: false});
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso2.address, add: true});
            assert.equal((await ftsoManager.getFtsos()).length, 1);

            const updateInitialPrice = ftsoInterface.contract.methods.updateInitialPrice(500, 1).encodeABI();
            const invocationCount = await mockFtso2.invocationCountForCalldata.call(updateInitialPrice);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should successfully replace an FTSO and update fasset", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(mockFtso.address);
            let mockFtso2 = await MockFtso.new();

            const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
            const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
            await mockFtso.givenMethodReturn(symbol, symbolReturn);
            await mockFtso2.givenMethodReturn(symbol, symbolReturn);

            const fasset = ftsoInterface.contract.methods.getFAsset().encodeABI();
            const fassetReturn = web3.eth.abi.encodeParameter('address', accounts[5]);
            await mockFtso.givenMethodReturn(fasset, fassetReturn);

            // Act
            let tx = await ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, false, true);

            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: false});
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso2.address, add: true});
            assert.equal((await ftsoManager.getFtsos()).length, 1);

            const setFAsset = ftsoInterface.contract.methods.setFAsset(accounts[5]).encodeABI();
            const invocationCount = await mockFtso2.invocationCountForCalldata.call(setFAsset);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should successfully replace an FTSO and update fasset ftsos", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(mockFtso.address);
            let mockFtso2 = await MockFtso.new();

            const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
            const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
            await mockFtso.givenMethodReturn(symbol, symbolReturn);
            await mockFtso2.givenMethodReturn(symbol, symbolReturn);

            const fassetFtsos = ftsoInterface.contract.methods.getFAssetFtsos().encodeABI();
            const fassetFtsosReturn = web3.eth.abi.encodeParameter('address[]', [accounts[5], accounts[6]]);
            await mockFtso.givenMethodReturn(fassetFtsos, fassetFtsosReturn);

            // Act
            let tx = await ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, false, true);

            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: false});
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso2.address, add: true});
            assert.equal((await ftsoManager.getFtsos()).length, 1);

            const setFAssetFtsos = ftsoInterface.contract.methods.setFAssetFtsos([accounts[5], accounts[6]]).encodeABI();
            const invocationCount = await mockFtso2.invocationCountForCalldata.call(setFAssetFtsos);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should successfully replace an FTSO and change fasset ftso", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            let multiFtso = await Ftso.new('FLR', constants.ZERO_ADDRESS, ftsoManager.address, constants.ZERO_ADDRESS, 0, 1e10, defaultPriceEpochCyclicBufferSize);
            await ftsoManager.addFtso(multiFtso.address);
            await ftsoManager.addFtso(mockFtso.address);
            await ftsoManager.setFtsoFAssetFtsos(multiFtso.address, [mockFtso.address]);
            let mockFtso2 = await MockFtso.new();

            await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
            await mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

            // Act
            let tx = await ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, false, false); 

            // // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: false});
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso2.address, add: true});
            assert.equal((await ftsoManager.getFtsos()).length, 2);

            assert.equal((await multiFtso.getFAssetFtsos())[0], mockFtso2.address);
        });

        it("Should revert at replacing an FTSO if not the same symbol", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(mockFtso.address);
            let mockFtso2 = await MockFtso.new();

            const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
            const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
            const symbolReturn2 = web3.eth.abi.encodeParameter('string', 'ATOK2');
            await mockFtso.givenMethodReturn(symbol, symbolReturn);
            await mockFtso2.givenMethodReturn(symbol, symbolReturn2);

            // Act
            let replacePromise = ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, false, false);

            // Assert
            await expectRevert(replacePromise, ERR_FTSO_SYMBOLS_MUST_MATCH);
        });

        it("Should revert at replacing an FTSO if not managed", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            let mockFtso2 = await MockFtso.new();

            await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
            await mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

            // Act
            let replacePromise = ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, false, false);

            // Assert
            await expectRevert(replacePromise, "Not found");
        });

        it("Should not remove an FTSO if not from governance", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(mockFtso.address);
            let mockFtso2 = await MockFtso.new();

            const symbol = ftsoInterface.contract.methods.symbol().encodeABI();
            const symbolReturn = web3.eth.abi.encodeParameter('string', 'ATOK');
            await mockFtso.givenMethodReturn(symbol, symbolReturn);
            await mockFtso2.givenMethodReturn(symbol, symbolReturn);
            
            // Act
            let removePromise = ftsoManager.removeFtso(mockFtso.address, { from: accounts[1] });

            // Assert
            await expectRevert(removePromise, ERR_GOVERNANCE_ONLY);
        });

        it("Should not add FTSO if initial governance parameters not set", async () => {
            let [ftso1, _] = await settingWithTwoFTSOs(accounts, ftsoManager);
            // init reward epoch
            
            let addPromise = ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await expectRevert(addPromise, ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS);
        });

        it("Should set FAsset to FTSO", async () => {
            let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
            
            const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;
            let fasset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;
            let fasset2Token = await MockVPToken.new(accounts.slice(0, 10), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]) as MockVPTokenInstance;
            
            // set fasset to ftso
            await ftsoManager.setFtsoFAsset(ftso1.address, fasset1Token.address);
            await ftsoManager.setFtsoFAsset(ftso2.address, fasset2Token.address);
            
            // ftso and fasset for ftso should match
            assert.equal(await ftso1.fAssetFtsos(0), ftso1.address);
            assert.equal(await ftso2.fAssetFtsos(0), ftso2.address);
            assert.equal(await ftso1.fAssets(0), fasset1Token.address);
            assert.equal(await ftso2.fAssets(0), fasset2Token.address);

            // length of fAssetFtsos lists should match
            await expectRevert.unspecified(ftso1.fAssetFtsos(1));
            await expectRevert.unspecified(ftso2.fAssetFtsos(1));
            await expectRevert.unspecified(ftso1.fAssets(1));
            await expectRevert.unspecified(ftso2.fAssets(1));
        });

        it("Should not set FAsset to FTSO if not from governance", async () => {
            let [ftso1, ] = await settingWithTwoFTSOs(accounts, ftsoManager);
            
            const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;
            let fasset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;
            
            // set fasset to ftso
            let setPromise = ftsoManager.setFtsoFAsset(ftso1.address, fasset1Token.address, {from: accounts[1]});

            await expectRevert(setPromise, ERR_GOVERNANCE_ONLY);
        });

        it("Should set FAsset FTSOs to FTSO", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);

            // set fasset ftsos to ftso
            await ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2,ftso3,ftso4].map(ftso => ftso.address));
            
            // multiasset ftsos for ftso 1 should match
            assert.equal(await ftso1.fAssetFtsos(0), ftso2.address);
            assert.equal(await ftso1.fAssetFtsos(1), ftso3.address);
            assert.equal(await ftso1.fAssetFtsos(2), ftso4.address);

            // length of fAssetFtsos lists should match
            await expectRevert.unspecified(ftso1.fAssetFtsos(3))
            await expectRevert.unspecified(ftso2.fAssetFtsos(1))
            await expectRevert.unspecified(ftso3.fAssetFtsos(1))
            await expectRevert.unspecified(ftso4.fAssetFtsos(1))
        });

        it("Should update FAsset FTSOs on FTSO", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso1.address);
            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);

            // set fasset ftsos to ftso
            await ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2,ftso3,ftso4].map(ftso => ftso.address));
            
            // multiasset ftsos for ftso 1 should match
            assert.equal(await ftso1.fAssetFtsos(0), ftso2.address);
            assert.equal(await ftso1.fAssetFtsos(1), ftso3.address);
            assert.equal(await ftso1.fAssetFtsos(2), ftso4.address);

            // length of fAssetFtsos lists should match
            await expectRevert.unspecified(ftso1.fAssetFtsos(3))
            await expectRevert.unspecified(ftso2.fAssetFtsos(1))
            await expectRevert.unspecified(ftso3.fAssetFtsos(1))
            await expectRevert.unspecified(ftso4.fAssetFtsos(1))
        });

        it("Should not set FAsset FTSOs to FTSO if not from governance", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);

            // set fasset ftsos to ftso
            let setPromise = ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2,ftso3,ftso4].map(ftso => ftso.address), {from: accounts[1]});

            await expectRevert(setPromise, ERR_GOVERNANCE_ONLY);
        });

        it("Should not set empty list of FAsset FTSOs to FTSO", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);

            // set fasset ftsos to ftso
            let setPromise = ftsoManager.setFtsoFAssetFtsos(ftso1.address, []);

            await expectRevert(setPromise, "fAsset ftsos list empty");
        });

        it("Should not set FTSO (itself) in FAsset FTSOs to FTSO", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);

            // set fasset ftsos to ftso
            let setPromise = ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2, ftso3, ftso1, ftso4].map(ftso => ftso.address));

            await expectRevert(setPromise, "ftso equals fAsset ftso");
        });

        it("Should add multi FAsset FTSO if all ftsos are added", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);

            // set fasset ftsos to ftso
            await ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2,ftso3,ftso4].map(ftso => ftso.address));
            await ftsoManager.addFtso(ftso1.address);
            
            // multiasset ftsos for ftso 1 should match
            assert.equal(await ftso1.fAssetFtsos(0), ftso2.address);
            assert.equal(await ftso1.fAssetFtsos(1), ftso3.address);
            assert.equal(await ftso1.fAssetFtsos(2), ftso4.address);

            // length of fAssetFtsos lists should match
            await expectRevert.unspecified(ftso1.fAssetFtsos(3))
            await expectRevert.unspecified(ftso2.fAssetFtsos(1))
            await expectRevert.unspecified(ftso3.fAssetFtsos(1))
            await expectRevert.unspecified(ftso4.fAssetFtsos(1))
        });

        it("Should not add multi FAsset FTSO if not all ftsos are added", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);

            // set fasset ftsos to ftso
            await ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2,ftso3,ftso4].map(ftso => ftso.address));
            await ftsoManager.removeFtso(ftso4.address);
            await expectRevert(ftsoManager.addFtso(ftso1.address), ERR_FASSET_FTSO_NOT_MANAGED);
        });

        it("Should not remove FTSO if used in multi FAsset ftso", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso2.address);
            await ftsoManager.addFtso(ftso3.address);
            await ftsoManager.addFtso(ftso4.address);
            
            // set fasset ftsos to ftso
            await ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2,ftso3,ftso4].map(ftso => ftso.address));
            await ftsoManager.addFtso(ftso1.address);
            await expectRevert(ftsoManager.removeFtso(ftso2.address), ERR_FASSET_FTSO_NOT_MANAGED);
        });

        it("Should governance set FTSO parameters to FTSO manager and then the FTSO manager set the FTSOs on init", async () => {
            // Setup 4 ftsos, ftso1 is multi asset, with reference to next 3 ftsos
            let [ftso1, ftso2, ftso3, ftso4] = await settingWithFourFTSOs(accounts, ftsoManager, true);
            // init reward epoch
            let paramList = [1, 1 + 2, 1000, 10001, 50, 1500, 10*DAY];
            let paramListBN = paramList.map(x => toBN(x));
            let paramListBNWithoutRewardExpiry = paramListBN.slice(0, -1)

            let trustedAddresses = [accounts[8], accounts[9]]

            // setup governance parameters
            await (ftsoManager.setGovernanceParameters as any)(...paramListBN, trustedAddresses);

            // add ftsos, parameters should be set by FTSOManager
            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso3.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso4.address, { from: accounts[0] });
            await ftsoManager.setFtsoFAssetFtsos(ftso1.address, [ftso2,ftso3,ftso4].map(ftso => ftso.address));

            await ftsoManager.activate();
            // await ftsoManager.daemonize();

            let ftso1Params = numberedKeyedObjectToList(await ftso1.epochsConfiguration());
            let ftso2Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());
            let ftso3Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());
            let ftso4Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());

            let trustedAddresses1 = ftso1Params.pop();
            let trustedAddresses2 = ftso2Params.pop();
            let trustedAddresses3 = ftso3Params.pop();
            let trustedAddresses4 = ftso4Params.pop();

            // numeric epoch configuration should match the set one
            assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso1Params as BN[]), "Wrong FTSO 1 governance parameters");
            assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso2Params as BN[]), "Wrong FTSO 2 governance parameters");
            assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso3Params as BN[]), "Wrong FTSO 3 governance parameters");
            assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso4Params as BN[]), "Wrong FTSO 4 governance parameters");

            compareArrays(trustedAddresses, trustedAddresses1 as string[]);
            compareArrays(trustedAddresses, trustedAddresses2 as string[]);
            compareArrays(trustedAddresses, trustedAddresses3 as string[]);
            compareArrays(trustedAddresses, trustedAddresses4 as string[]);

        });

        it("Should governance set FTSO parameters after two price finalizations", async () => {
            let [ftso1, ftso2] = await settingWithFourFTSOs(accounts, ftsoManager, true);

            let priceSubmitterInterface = await PriceSubmitter.new();
            // init reward epoch
            let defaultParamList = [1, 1, 1000, 10000, 50, 1500, 10*DAY];
            let defaultParamListBN = defaultParamList.map(x => toBN(x));
            let trustedAddresses = [accounts[6], accounts[7]];
            await (ftsoManager.setGovernanceParameters as any)(...defaultParamListBN, trustedAddresses);   

            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

            await ftsoManager.activate();
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch
            
            // check price submitter trusted addresses
            const setTrustedAddresses1 = priceSubmitterInterface.contract.methods.setTrustedAddresses(trustedAddresses).encodeABI();
            const invocationCount1 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddresses1);
            assert.equal(invocationCount1.toNumber(), 1);
            
            await time.increaseTo(startTs.addn(120 + 30));
            await ftsoManager.daemonize(); // finalize price epoch
            await ftsoManager.daemonize(); // initialize price epoch

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120 * 2));
            await ftsoManager.daemonize();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 2 + 30));
            let tx = await ftsoManager.daemonize(); // finalize price epoch
            await ftsoManager.daemonize(); // initialize price epoch
            
            // Assert
            expectEvent(tx, "PriceEpochFinalized");

            epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120 * 3));
            tx = await ftsoManager.daemonize();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 3 + 30));
            tx = await ftsoManager.daemonize(); // finalize price epoch
            await ftsoManager.daemonize(); // initialize price epoch

            expectEvent(tx, "PriceEpochFinalized");

            epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            let paramList = [1, 1 + 2, 1000, 10001, 50, 1500, 10*DAY];
            let paramListBN = paramList.map(x => toBN(x));
            let paramListBNWithoutRewardExpiry = paramListBN.slice(0, -1)

            trustedAddresses = [accounts[8], accounts[9]];
            await (ftsoManager.setGovernanceParameters as any)(...paramListBN, trustedAddresses);

            await time.increaseTo(startTs.addn(120 * 4));
            tx = await ftsoManager.daemonize();
            
            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);
            
            await time.increaseTo(startTs.addn(120 * 4 + 30));
            tx = await ftsoManager.daemonize(); // finalize price epoch
            expectEvent(tx, "PriceEpochFinalized");

            await ftsoManager.daemonize(); // initialize price epoch

            // check price submitter trusted addresses
            const setTrustedAddresses2 = priceSubmitterInterface.contract.methods.setTrustedAddresses(trustedAddresses).encodeABI();
            const invocationCount2 = await mockPriceSubmitter.invocationCountForCalldata.call(setTrustedAddresses2);
            assert.equal(invocationCount2.toNumber(), 1);


            let ftso1Params = numberedKeyedObjectToList(await ftso1.epochsConfiguration());
            let ftso2Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());

            let trustedAddresses1 = ftso1Params.pop();
            let trustedAddresses2 = ftso2Params.pop();

            assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso1Params as BN[]), "Wrong FTSO 1 governance parameters");
            assert(doBNListsMatch(paramListBNWithoutRewardExpiry, ftso2Params as BN[]), "Wrong FTSO 2 governance parameters");
            assert(!doBNListsMatch(paramListBN, defaultParamListBN), "Changed parameters should not match the default ones.");
            compareArrays(trustedAddresses, trustedAddresses1 as string[]);
            compareArrays(trustedAddresses, trustedAddresses2 as string[]);
        });

        it("Should emit event if initialize price epoch fails and catches reverted error", async () => {
            // Assemble
            // stub ftso initialize
            const initializePriceEpoch = ftsoInterface.contract.methods.initializeCurrentEpochStateForReveal(false).encodeABI();
            await mockFtso.givenMethodRevertWithMessage(initializePriceEpoch,"I am broken");

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();

            
            await time.increaseTo(startTs.addn(120));

            // Act
            // Simulate the daemon tickling reward manager
            let tx = await ftsoManager.daemonize();
            // Assert
            expectEvent(tx, "InitializingCurrentEpochStateForRevealFailed", {ftso: mockFtso.address, epochId: toBN(1)})

            const { 
                0: lastErrorBlockArr,
                1: numErrorsArr,
                2: errorStringArr,
                3: errorContractArr,
                4: totalDaemonizedErrors
               } = await ftsoManager.showRevertedErrors(0, 1);

            assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[2].blockNumber);
            assert.equal(numErrorsArr[0].toNumber(), 1);
            assert.equal(errorStringArr[0], "I am broken");
            assert.equal(errorContractArr[0], ftsoManager.address);
            assert.equal(totalDaemonizedErrors.toNumber(), 1);    
        });

    });

    describe("Price epochs, finalization", async () => {
        it("Should finalize a price epoch only", async () => {
            // Assemble
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch
            
            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));
            // Act
            let tx = await ftsoManager.daemonize();
            // Assert
            expectEvent(tx, "PriceEpochFinalized");
            expectEvent.notEmitted(tx, "RewardEpochFinalized");
        });

        it("Should finalize a price epoch at the configured interval", async () => {
            // Assemble
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30)); 
            await ftsoManager.daemonize(); // finalize price epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel another 120 seconds
            await time.increaseTo(startTs.addn(120 * 2 + 30));
            // Act
            let tx = await ftsoManager.daemonize();
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
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            let tx = await ftsoManager.daemonize();

            // Assert
            expectEvent(tx, "PriceEpochFinalized");
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

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // intialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the daemon tickling reward manager
            await ftsoManager.daemonize();

            // address[] memory addresses,
            // uint256[] memory weights,
            // uint256 totalWeight,
            // uint256 epochId,
            // address ftso,
            // uint256 priceEpochDurationSeconds,
            // uint256 currentRewardEpoch
            const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                mockFtso.address,
                120,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                await ftsoManager.getRewardEpochVotePowerBlock(0)
            ).encodeABI();

            // Assert
            const invocationCountWithData = await mockRewardManager.invocationCountForCalldata.call(distributeRewards);
            assert.equal(invocationCountWithData.toNumber(), 1);
        });

        it("Should finalize price epoch and emit event if distribute rewards fails", async () => {
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

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // address[] memory addresses,
            // uint256[] memory weights,
            // uint256 totalWeight,
            // uint256 epochId,
            // address ftso,
            // uint256 priceEpochDurationSeconds,
            // uint256 currentRewardEpoch
            const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                mockFtso.address,
                120,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                await ftsoManager.getRewardEpochVotePowerBlock(0)
            ).encodeABI();

            await mockRewardManager.givenMethodRevertWithMessage(distributeRewards,"I am broken");
            // Act
            // Simulate the daemon tickling reward manager
            let tx = await ftsoManager.daemonize();

            // Assert
            expectEvent(tx, "DistributingRewardsFailed", {ftso: mockFtso.address, epochId: toBN(0)})
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
            // await web3.eth.sendTransaction({ from: accounts[0], to: mockRewardManager.address, value: 1000000 });

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey unrewardable ftso 0
            await ftsoManager.addFtso(mockFtsoNoAccounts.address, { from: accounts[0] });
            // add fakey rewardable ftso 1
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the daemon tickling reward manager
            await ftsoManager.daemonize();

            // Assert
            const { chosenFtso, rewardEpochId, rewardDistributed } = await ftsoManager.priceEpochs(0) as any;
            // Should equal FTSO 1, the next eligible ftso in the list
            assert.equal(chosenFtso, mockFtso.address);
            assert.equal(rewardDistributed, true);
        });

        it("Should force finalize the price after one finalization", async () => {
            let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
            // init reward epoch
            await setDefaultGovernanceParameters(ftsoManager);

            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch

            await time.increaseTo(startTs.addn(120 + 30));
            await ftsoManager.daemonize(); // initialize price epoch

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120 * 2));
            await ftsoManager.daemonize();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 2 + 30));
            await ftsoManager.daemonize(); // finalize price epoch
            
            let ftso1Events = await ftso1.getPastEvents("PriceFinalized")
            let ftso2Events = await ftso2.getPastEvents("PriceFinalized")
            assert.equal(lastOf(ftso1Events).args.finalizationType.toNumber(), 1);
            assert.equal(lastOf(ftso2Events).args.finalizationType.toNumber(), 1);
            
            // initialize price epoch is called in a separate block as finalize price epoch
            await ftsoManager.daemonize();

            // reveal only for ftso2, not ftso1
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(3 * 120));
            await ftsoManager.daemonize();

            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(3 * 120 + 30));

            // finalize, ftso1 will force finalize
            await ftsoManager.daemonize();

            ftso1Events = await ftso1.getPastEvents("PriceFinalized");
            ftso2Events = await ftso2.getPastEvents("PriceFinalized");
            assert.equal(lastOf(ftso1Events).args.finalizationType.toNumber(), 3);
            assert.equal(lastOf(ftso2Events).args.finalizationType.toNumber(), 1);
        });

        it("Should emit event if finalize price epoch fails due to WEIGHTED_MEDIAN", async () => {
            // Assemble
            // stub ftso randomizer
            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const averageFinalizePriceEpoch = ftsoInterface.contract.methods.averageFinalizePriceEpoch(0).encodeABI();
            const forceFinalizePriceEpoch = ftsoInterface.contract.methods.forceFinalizePriceEpoch(0).encodeABI();
            await mockFtso.givenMethodRevertWithMessage(finalizePriceEpoch,"I am broken");
            await mockFtso.givenMethodRevertWithMessage(averageFinalizePriceEpoch,"averageFinalizePriceEpoch broken too");
            await mockFtso.givenMethodRevertWithMessage(forceFinalizePriceEpoch,"forceFinalizePriceEpoch broken too");

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel to reveal end
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the daemon tickling reward manager
            let tx = await ftsoManager.daemonize();

            // Assert
            // FinalizingPriceEpochFailed due to WEIGHTED_MEDIAN
            expectEvent(tx, "FinalizingPriceEpochFailed", {ftso: mockFtso.address, epochId: toBN(0), failingType:toBN(1)})
            
            let finalizingPriceEpochFailedEvents = await ftsoManager.getPastEvents("FinalizingPriceEpochFailed")
            
            const { 
                0: lastErrorBlockArr,
                1: numErrorsArr,
                2: errorStringArr,
                3: errorContractArr,
                4: totalDaemonizedErrors
            } = await ftsoManager.showRevertedErrors(0, 3);

            assert.equal(lastErrorBlockArr[0].toNumber(), finalizingPriceEpochFailedEvents[0].blockNumber);
            assert.equal(numErrorsArr[0].toNumber(), 1);
            assert.equal(errorStringArr[0], "I am broken");
            assert.equal(errorContractArr[0], mockFtso.address);
            assert.equal(totalDaemonizedErrors.toNumber(), 3);
        });

        it("Should emit event if finalize price epoch fails due to TRUSTED_ADDRESSES", async () => {
            // Assemble
            // stub ftso randomizer
            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const averageFinalizePriceEpoch = ftsoInterface.contract.methods.averageFinalizePriceEpoch(0).encodeABI();
            const forceFinalizePriceEpoch = ftsoInterface.contract.methods.forceFinalizePriceEpoch(0).encodeABI();
            await mockFtso.givenMethodRevertWithMessage(finalizePriceEpoch,"I am broken");
            await mockFtso.givenMethodRevertWithMessage(averageFinalizePriceEpoch,"averageFinalizePriceEpoch broken too");
            await mockFtso.givenMethodRevertWithMessage(forceFinalizePriceEpoch,"forceFinalizePriceEpoch broken too");

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling reward manager
            let tx = await ftsoManager.daemonize();

            // Assert
            // FinalizingPriceEpochFailed due to TRUSTED_ADDRESSES
            expectEvent(tx, "FinalizingPriceEpochFailed", {ftso: mockFtso.address, epochId: toBN(0), failingType:toBN(2)})

            let finalizingPriceEpochFailedEvents = await ftsoManager.getPastEvents("FinalizingPriceEpochFailed")

            const {
                0: lastErrorBlockArr1,
                1: numErrorsArr1,
                2: errorStringArr1,
                3: errorContractArr1,
                4: totalDaemonizedErrors1
            } = await ftsoManager.showRevertedErrors(0, 3);

            assert.equal(lastErrorBlockArr1[1].toNumber(), finalizingPriceEpochFailedEvents[1].blockNumber);
            assert.equal(numErrorsArr1[1].toNumber(), 1);
            assert.equal(errorStringArr1[1], "averageFinalizePriceEpoch broken too");
            assert.equal(errorContractArr1[1], mockFtso.address);
            assert.equal(totalDaemonizedErrors1.toNumber(), 3);
        });

        it("Should emit event if finalize price epoch fails due to PREVIOUS_PRICE_COPIED", async () => {
            // Assemble
            // stub ftso randomizer
            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const averageFinalizePriceEpoch = ftsoInterface.contract.methods.averageFinalizePriceEpoch(0).encodeABI();
            const forceFinalizePriceEpoch = ftsoInterface.contract.methods.forceFinalizePriceEpoch(0).encodeABI();
            await mockFtso.givenMethodRevertWithMessage(finalizePriceEpoch,"I am broken");
            await mockFtso.givenMethodRevertWithMessage(averageFinalizePriceEpoch,"averageFinalizePriceEpoch broken too");
            await mockFtso.givenMethodRevertWithMessage(forceFinalizePriceEpoch,"forceFinalizePriceEpoch broken too");

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling reward manager
            let tx = await ftsoManager.daemonize();

            // Assert
            // FinalizingPriceEpochFailed due to PREVIOUS_PRICE_COPIED
            expectEvent(tx, "FinalizingPriceEpochFailed", {ftso: mockFtso.address, epochId: toBN(0), failingType:toBN(3)})
            
            let finalizingPriceEpochFailedEvents = await ftsoManager.getPastEvents("FinalizingPriceEpochFailed")
            
            const {
                0: lastErrorBlockArr2,
                1: numErrorsArr2,
                2: errorStringArr2,
                3: errorContractArr2,
                4: totalDaemonizedErrors2
            } = await ftsoManager.showRevertedErrors(0, 3);

            assert.equal(lastErrorBlockArr2[2].toNumber(), finalizingPriceEpochFailedEvents[2].blockNumber);
            assert.equal(numErrorsArr2[2].toNumber(), 1);
            assert.equal(errorStringArr2[2], "forceFinalizePriceEpoch broken too");
            assert.equal(errorContractArr2[2], mockFtso.address);
            assert.equal(totalDaemonizedErrors2.toNumber(), 3);
        });
    });
    
    describe("Reward epochs, finalization", async () => {
        it("Should finalize a reward epoch", async () => {
            // Assemble
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800 + REVEAL_EPOCH_DURATION_S));
            // Act
            let tx = await ftsoManager.daemonize();
            // // Assert
            expectEvent(tx, "RewardEpochFinalized");
        });

        it("Should finalize a reward epoch at the configured interval", async () => {
            // Assemble
            await ftsoManager.activate();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            await ftsoManager.daemonize();
            // Time travel another 2 days
            await time.increaseTo(startTs.addn(172800 * 2));
            // Act
            let tx = await ftsoManager.daemonize();
            // Assert
            expectEvent(tx, "RewardEpochFinalized");
        });

        it("Should set cleanup block after finalization", async () => {
            // Assemble
            await ftsoManager.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);
            await cleanupBlockNumberManager.setTriggerContractAddress(ftsoManager.address);
            const mockVpToken = await MockContract.new();
            await cleanupBlockNumberManager.registerToken(mockVpToken.address);
            await ftsoManager.activate();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            await ftsoManager.daemonize();
            // Time travel another 2 days
            await time.increaseTo(startTs.addn(172800 * 2));
            // Act
            let receipt = await ftsoManager.daemonize();
            // Assert
            await expectEvent.inTransaction(receipt.tx, cleanupBlockNumberManager, 
                "CleanupBlockNumberSet", { theContract: mockVpToken.address, success: true });
        });

        it("Must be set as trigger to allow setting cleanup block", async () => {
            // Assemble
            await ftsoManager.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);
            const mockVpToken = await MockContract.new();
            await cleanupBlockNumberManager.registerToken(mockVpToken.address);
            await ftsoManager.activate();
            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));
            await ftsoManager.daemonize();
            // Time travel another 2 days
            await time.increaseTo(startTs.addn(172800 * 2));
            // Act
            let receipt = await ftsoManager.daemonize();
            // Assert
            expectEvent(receipt, "CleanupBlockNumberManagerFailedForBlock", {});
            await expectEvent.notEmitted.inTransaction(receipt.tx, cleanupBlockNumberManager, "CleanupBlockNumberSet")
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
            await ftsoManager.daemonize();
            // Assert
            const { votepowerBlock, startBlock } = await ftsoManager.rewardEpochs(0) as any;
            assert.equal(votepowerBlock.toNumber(), b[0]);
            assert.equal(startBlock.toNumber(), b[0] + 1);
        });

        it("Should select vote power block in the correct interval and be random", async () => {
            await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
            await ftsoManager.daemonize();
            let b: number[] = [];
            let rewardEpochDataList: any[] = [];
            let currentSnapshotTime = startTs.addn(REWARD_EPOCH_DURATION_S)
            await time.increaseTo(currentSnapshotTime);
            await time.advanceBlock();

            b[0] = await web3.eth.getBlockNumber();
            // Act
            await ftsoManager.daemonize();
            let secondsPerBlock = 60 * 60 * 6;
            let noRuns = 5;
            for (let i = 0; i < noRuns; i++) {
                let res = toNumberify(await ftsoManager.rewardEpochs(i) as any as RewardEpochData) as any;
                rewardEpochDataList.push(res);
                for (let j = 0; j < REWARD_EPOCH_DURATION_S; j += secondsPerBlock) {
                    currentSnapshotTime = currentSnapshotTime.addn(secondsPerBlock);
                    await time.increaseTo(currentSnapshotTime);
                    // time.increaseTo doesn't increase block number enough, so there is almost no space for random votePowerBlock (after we divide by 7)
                    for (let k = 0; k < 10; k++) {
                        await time.advanceBlock();
                    }
                    await ftsoManager.daemonize();
                }
            }
            let offsets = new Set<number>();
            for (let i = 1; i < rewardEpochDataList.length; i++) {
                rewardEpochDataList[i].diff = rewardEpochDataList[i].startBlock - rewardEpochDataList[i - 1].startBlock;
                rewardEpochDataList[i].offset = rewardEpochDataList[i].startBlock - rewardEpochDataList[i].votepowerBlock;
                rewardEpochDataList[i].min = rewardEpochDataList[i].startBlock - Math.ceil(rewardEpochDataList[i].diff / VOTE_POWER_BOUNDARY_FRACTION);
                offsets.add(rewardEpochDataList[i].offset);
                assert(rewardEpochDataList[i].votepowerBlock >= rewardEpochDataList[i].min, "Vote power block in wrong range.");
            }
            assert(offsets.size > 1, "Offsets not random (ok to fail with small probability)");
        });

        it("Should finalize a reward epoch and designate a new vote power block, setting FTSOs to new block", async() => {
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
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, {from: accounts[0]});
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();

            // Act
            for (var i = 1; i <= (172800 / 1200); i++) {
                // Time travel to trigger a price epoch change
                // Cheat and do every 20 mins to reduce test time
                await time.increaseTo(startTs.addn(1200 * i + REVEAL_EPOCH_DURATION_S));
                // Mine at least a block
                await time.advanceBlock();
                await ftsoManager.daemonize();
            }

            // finalize reward epoch is called in a separate block as finalize price epoch
            await ftsoManager.daemonize();

            // Assert
            // Get the invocation count for setting new vote power block on mocked FTSO
            const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
            // Should be 2 invocations; 1 during initializing first reward epoch, 1 during reward epoch finalization - for 1 FTSO
            assert.equal(invocationCount.toNumber(), 2);
        });

        it("Should emit event if close expired reward epochs fails", async () => {
            // Assemble
            // stub ftso initialize
            const closeExpiredRewardEpoch = ftsoRewardManagerInterface.contract.methods.closeExpiredRewardEpoch(0,1).encodeABI();
            await mockRewardManager.givenMethodRevertWithMessage(closeExpiredRewardEpoch,"I am broken");

            await setDefaultGovernanceParameters(ftsoManager);
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();

            // act - go through 6 2-day rewardEpochs, so the first can be expired
            let tx = null;
            for(let i = 1; i <= 6; i++) {
                await time.increaseTo(startTs.addn(i*2*DAY + REVEAL_EPOCH_DURATION_S)); // i*two days
                tx = await ftsoManager.daemonize();
            }
            // Assert
            expectEvent(tx!, "ClosingExpiredRewardEpochFailed");
        });

        it("Should call distribute rewards correctly at the transition to the next reward epoch", async () => {
            let yearSeconds = 60 * 60 * 24 * 365; // 2021
            
            // longer reward and price epochs - time travel and calling daemonize()
            ftsoManager = await FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                mockPriceSubmitter.address,
                ftsoRegistry.address,
                mockVoterWhitelister.address,
                yearSeconds / 10,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                yearSeconds,
                startTs.addn(REVEAL_EPOCH_DURATION_S),
                VOTE_POWER_BOUNDARY_FRACTION,
            );

            await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address, {from: accounts[0]});

            // stub ftso randomizer
            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
            const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
                ['address[]', 'uint256[]', 'uint256'],
                [[accounts[1], accounts[2]], [25, 75], 100]);
            await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activate ftso manager
            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize(); // initialize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch

            // Time travel
            for (let i = 1; i < 10; i++) { // one year
                await time.increaseTo(startTs.addn(i * yearSeconds / 10 + 30));
                await ftsoManager.daemonize(); // finalize price epoch
                await ftsoManager.daemonize(); // initialize price epoch
            }

            await time.increaseTo(startTs.addn(10 * yearSeconds / 10 + 30));
            await ftsoManager.daemonize(); // finalize price epoch
            await ftsoManager.daemonize(); // finalize reward epoch
            await ftsoManager.daemonize(); // initialize price epoch
            
            // Act
            // Simulate the daemon tickling reward manager
            await time.increaseTo(startTs.addn(11 * yearSeconds / 10 + 30));
            await ftsoManager.daemonize(); // finalize price epoch

            // address[] memory addresses,
            // uint256[] memory weights,
            // uint256 totalWeight,
            // uint256 epochId,
            // address ftso,
            // uint256 priceEpochDurationSeconds,
            // uint256 currentRewardEpoch
            // uint256 _priceEpochEndTime, // end time included in epoch
            // uint256 _votePowerBlock
            const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                9,
                mockFtso.address,
                yearSeconds / 10,
                0,
                startTs.addn((yearSeconds / 10 * 10) - 1),
                await ftsoManager.getRewardEpochVotePowerBlock(0)
            ).encodeABI();

            const distributeRewards2 = ftsoRewardManagerInterface.contract.methods.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                10,
                mockFtso.address,
                yearSeconds / 10,
                1,
                startTs.addn((yearSeconds / 10 * 11) - 1),
                await ftsoManager.getRewardEpochVotePowerBlock(1)
            ).encodeABI();

            // Assert
            const invocationCountWithData = await mockRewardManager.invocationCountForCalldata.call(distributeRewards);
            assert.equal(invocationCountWithData.toNumber(), 1);
            const invocationCountWithData2 = await mockRewardManager.invocationCountForCalldata.call(distributeRewards2);
            assert.equal(invocationCountWithData2.toNumber(), 1);
        });
    });

    describe("fallback mode", async () => {
        it("Should set fallback mode", async () => {
            await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
            await ftsoManager.setFallbackMode(true, { from: accounts[0] });
            assert(await ftsoManager.fallbackMode());

            await ftsoManager.setFallbackMode(false, { from: accounts[0] });
            assert(!await ftsoManager.fallbackMode());
        });

        it("Should not set fallback mode if not from governance", async () => {
            await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
            await expectRevert(ftsoManager.setFallbackMode(true, { from: accounts[1] }), ERR_GOVERNANCE_ONLY);
        });

        it("Should set fallback mode for ftso", async () => {
            let [ftso1, ] = await settingWithTwoFTSOs(accounts, ftsoManager);
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });
            assert(await ftsoManager.ftsoInFallbackMode(ftso1.address));

            await ftsoManager.setFtsoFallbackMode(ftso1.address, false, { from: accounts[0] });
            assert(!await ftsoManager.ftsoInFallbackMode(ftso1.address));
        });
        
        it("Should not set fallback mode for ftso if not managed", async () => {
            let [ftso1, ] = await settingWithTwoFTSOs(accounts, ftsoManager);
            await expectRevert(ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] }), "Not found");
        });

        it("Should not set fallback mode for ftso if not from governance", async () => {
            let [ftso1, ] = await settingWithTwoFTSOs(accounts, ftsoManager);
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await expectRevert(ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[1] }), ERR_GOVERNANCE_ONLY);
        });

        it("Should initialize epochs in fallback mode for all ftsos", async () => {
            let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

            await ftsoManager.setFallbackMode(true, { from: accounts[0] });

            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.daemonize();

            let report1 = await ftso1.getFullEpochReport(epoch.add(toBN(1)));
            expect(report1[12]).to.equals(true);

            let report2 = await ftso2.getFullEpochReport(epoch.add(toBN(1)));
            expect(report2[12]).to.equals(true);
        });

        it("Should initialize epoch in fallback mode for first ftso", async () => {
            let [ftso1, ftso2] = await settingWithTwoFTSOs(accounts, ftsoManager);
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

            await ftsoManager.setFtsoFallbackMode(ftso1.address, true, { from: accounts[0] });

            await ftsoManager.activate();
            await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
            await ftsoManager.daemonize();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.daemonize();

            let report1 = await ftso1.getFullEpochReport(epoch.add(toBN(1)));
            expect(report1[12]).to.equals(true);

            let report2 = await ftso2.getFullEpochReport(epoch.add(toBN(1)));
            expect(report2[12]).to.equals(false);
        });
    });
});
