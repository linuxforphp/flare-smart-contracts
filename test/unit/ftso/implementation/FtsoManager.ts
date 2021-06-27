import {
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


const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../../utils/constants').getTestFile;

const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const FtsoManager = artifacts.require("FtsoManager");
const Ftso = artifacts.require("Ftso");
const MockFtso = artifacts.require("MockContract");
const MockFtsoContract = artifacts.require("MockFtso");
const MockContract = artifacts.require("MockContract");
const MockRewardManager = artifacts.require("MockContract");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const ERR_GOVERNANCE_ONLY = "only governance"
const ERR_GOV_PARAMS_NOT_INIT_FOR_FTSOS = "Gov. params not initialized"
const ERR_FASSET_FTSO_NOT_MANAGED = "FAsset FTSO not managed by ftso manager";
const ERR_NOT_FOUND = "FTSO symbol not supported";
const ERR_FTSO_SYMBOLS_MUST_MATCH = "FTSO symbols must match";



contract(`FtsoManager.sol; ${ getTestFile(__filename) }; Ftso manager unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoManager: FtsoManagerInstance;
    let startTs: BN;
    let mockRewardManager: MockContractInstance;
    let ftsoRewardManagerInterface: FtsoRewardManagerInstance;
    let mockFtso: MockContractInstance;
    let ftsoInterface: FtsoInstance;
    let ftsoRegistry: FtsoRegistryInstance;

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
            1e10
        );

        await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
        
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        mockRewardManager = await MockRewardManager.new();
        ftsoRewardManagerInterface = await FtsoRewardManager.new(
            accounts[0],
            3,
            0,
            100,
            (await MockContract.new()).address
        );

        ftsoRegistry = await FtsoRegistry.new(accounts[0]);

        ftsoManager = await FtsoManager.new(
            accounts[0],
            accounts[0],
            mockRewardManager.address,
            accounts[7],
            ftsoRegistry.address,
            PRICE_EPOCH_DURATION_S,
            startTs,
            REVEAL_EPOCH_DURATION_S,
            REWARD_EPOCH_DURATION_S,
            startTs,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        ftsoRegistry.setFtsoManagerAddress(ftsoManager.address, {from: accounts[0]});

    });

    describe("basic", async () => {
        it("Should revert at deploy if setting invalid parameters", async () => {
            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                0,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs,
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Price epoch 0");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                0,
                REWARD_EPOCH_DURATION_S,
                startTs,
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reveal price epoch 0");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                0,
                startTs,
                VOTE_POWER_BOUNDARY_FRACTION
            ), "Reward epoch 0");

            await expectRevert(FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                PRICE_EPOCH_DURATION_S,
                startTs.addn(500),
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs,
                VOTE_POWER_BOUNDARY_FRACTION
            ), "First epoch start timestamp in future");
        });

        it("Should return price submitter address", async () => {
            expect(await ftsoManager.priceSubmitter()).to.equals(accounts[7]);
        });

        it("Should return true when calling keep and ftso manager is active", async () => {
            await ftsoManager.activate();
            expect(await ftsoManager.keep.call()).to.equals(true);
        });

        it("Should return false when calling keep and ftso manager not active", async () => {
            expect(await ftsoManager.keep.call()).to.equals(false);
        });
        
        it("Should revert calling keep if not from flare keeper", async () => {
            await ftsoManager.activate();
            await expectRevert(ftsoManager.keep({ from : accounts[1]}), "only flare keeper");
        });

        it("Should get current price epoch data", async () => {
            let epochId = Math.floor((await time.latest() - startTs.toNumber()) / PRICE_EPOCH_DURATION_S);
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
            expect((await ftsoManager.getCurrentRewardEpoch()).toNumber()).to.equals(0);
            await ftsoManager.activate();
            await ftsoManager.keep();

            await time.increaseTo(startTs.addn(REWARD_EPOCH_DURATION_S));
            await ftsoManager.keep();

            expect((await ftsoManager.getCurrentRewardEpoch()).toNumber()).to.equals(1);
        });

        it("Should get reward epoch vote power block", async () => {
            await ftsoManager.activate();
            await ftsoManager.keep();

            let block = await web3.eth.getBlockNumber();

            expect((await ftsoManager.getRewardEpochVotePowerBlock(0)).toNumber()).to.equals(block-1);
        });

        it("Should not set governance paramters if not from governance", async () => {
            await expectRevert(ftsoManager.setGovernanceParameters(10, 10, 5, 5, 50, 500, 500, 5000, [], { from: accounts[2] }), "only governance");
        });

        it("Should not set governance paramters if not from governance", async () => {
            await expectRevert(ftsoManager.setGovernanceParameters(10, 10, 5, 5, 50, 500, 500, 5000, [], { from: accounts[2] }), "only governance");
        });

        it("Should revert setting invalid governance parameters", async () => {
            await expectRevert(ftsoManager.setGovernanceParameters(0, 10, 5, 5, 50, 500, 500, 5000, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(10, 0, 5, 5, 50, 500, 500, 5000, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(10, 10, 0, 5, 50, 500, 500, 5000, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(10, 10, 5, 0, 50, 500, 500, 5000, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(10, 10, 5, 5, 500, 50, 500, 5000, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(10, 10, 5, 5, 50, 500, 50000, 5000, []), "Gov. params invalid");
            await expectRevert(ftsoManager.setGovernanceParameters(10, 10, 5, 5, 50, 500, 500, 50000, []), "Gov. params invalid");
        });

        it("Should activate", async () => {
            await ftsoManager.activate();
        });

        it("Should not activate if not from governance", async () => {
            await expectRevert(ftsoManager.activate({ from: accounts[2] }), "only governance");
        });

        it("Should deactivate", async () => {
            await ftsoManager.deactivate();
        });

        it("Should not deactivate if not from governance", async () => {
            await expectRevert(ftsoManager.deactivate({ from: accounts[2] }), "only governance");
        });

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
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: true});
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);

            const activate = web3.utils.sha3("activateFtso(address,uint256,uint256,uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(activate);
            assert.equal(invocationCount.toNumber(), 1);

            const configureEpochs = web3.utils.sha3("configureEpochs(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address[])")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount2 = await mockFtso.invocationCountForMethod.call(configureEpochs);
            assert.equal(invocationCount2.toNumber(), 1);
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
            ftsoManager = await FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                PRICE_EPOCH_DURATION_S,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                REWARD_EPOCH_DURATION_S,
                startTs.addn(500),
                VOTE_POWER_BOUNDARY_FRACTION
            );
            
            ftsoRegistry.setFtsoManagerAddress(ftsoManager.address, {from: accounts[0]});

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
            await ftsoManager.keep();
            
            // Get the invocation count for setting new vote power block on mocked FTSO
            const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0,10); // first 4 bytes is function selector
            // Act
            for (var i = 1; i < 10; i++) {
                // Time travel to trigger a first initialize reward epoch
                // Cheat and do every 50 seconds to reduce test time
                await time.increaseTo(startTs.addn(50 * i));
                // Mine at least a block
                await time.advanceBlock();
                await ftsoManager.keep();
                const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
                assert.equal(invocationCount.toNumber(), 0);
            }

            // Assert
            await time.increaseTo(startTs.addn(500));
            await time.advanceBlock();
            await ftsoManager.keep();
            const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
            // Should be 1 invocation during initializing first reward epoch - for 1 FTSO
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should sucessfully add an FTSO even if ftso manager is active", async () => {
            // Assemble
            await ftsoManager.activate();
            await ftsoManager.keep();
            await setDefaultGovernanceParameters(ftsoManager);
            
            // Act
            let tx = await ftsoManager.addFtso(mockFtso.address);
            
            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: true});
            assert.equal(mockFtso.address, (await ftsoManager.getFtsos())[0]);
            
            const activate = web3.utils.sha3("activateFtso(address,uint256,uint256,uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(activate);
            assert.equal(invocationCount.toNumber(), 1);

            const configureEpochs = web3.utils.sha3("configureEpochs(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,address[])")!.slice(0,10); // first 4 bytes is function selector
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

        it("Should sucessfully remove an FTSO", async () => {
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

        it("Should sucessfully replace an FTSO and not update initial price", async () => {
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

            // Act
            let tx = await ftsoManager.replaceFtso(mockFtso.address, mockFtso2.address, false, false);

            // Assert
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso.address, add: false});
            expectEvent(tx, "FtsoAdded", {ftso: mockFtso2.address, add: true});
            assert.equal((await ftsoManager.getFtsos()).length, 1);

            const updateInitialPrice = web3.utils.sha3("updateInitialPrice(uint256,uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(updateInitialPrice);
            assert.equal(invocationCount.toNumber(), 0);
        });

        it("Should sucessfully replace an FTSO and update initial price", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            await ftsoManager.addFtso(mockFtso.address);
            let mockFtso2 = await MockFtso.new();

            mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);
            mockFtsoSymbol("ATOK", mockFtso2, ftsoInterface);

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

        it("Should sucessfully replace an FTSO and update fasset", async () => {
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

        it("Should sucessfully replace an FTSO and update fasset ftsos", async () => {
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

        it("Should sucessfully replace an FTSO and change fasset ftso", async () => {
            // Assemble
            await setDefaultGovernanceParameters(ftsoManager);
            let multiFtso = await Ftso.new('FLR', constants.ZERO_ADDRESS, ftsoManager.address, constants.ZERO_ADDRESS, 0, 1e10);
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
            let paramList = [1e10 + 1, 1e10 + 2, 1, 1 + 2, 1000, 10001, 50, 1500];
            let paramListBN = paramList.map(x => toBN(x));

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
            // await ftsoManager.keep();

            let ftso1Params = numberedKeyedObjectToList(await ftso1.epochsConfiguration());
            let ftso2Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());
            let ftso3Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());
            let ftso4Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());
            
            let trustedAddresses1 = ftso1Params.pop();
            let trustedAddresses2 = ftso2Params.pop();
            let trustedAddresses3 = ftso3Params.pop();
            let trustedAddresses4 = ftso4Params.pop();

            // numeric epoch configuration should match the set one
            assert(doBNListsMatch(paramListBN, ftso1Params as BN[]), "Wrong FTSO 1 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso2Params as BN[]), "Wrong FTSO 2 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso3Params as BN[]), "Wrong FTSO 3 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso4Params as BN[]), "Wrong FTSO 4 governance parameters");

            compareArrays(trustedAddresses, trustedAddresses1 as string[]);
            compareArrays(trustedAddresses, trustedAddresses2 as string[]);
            compareArrays(trustedAddresses, trustedAddresses3 as string[]);
            compareArrays(trustedAddresses, trustedAddresses4 as string[]);
        });

        it("Should governance set FTSO parameters after two price finalizations", async () => {
            let [ftso1, ftso2] = await settingWithFourFTSOs(accounts, ftsoManager, true);

            // init reward epoch
            let defaultParamList = [1e10, 1e10, 1, 1, 1000, 10000, 50, 1500];
            let defaultParamListBN = defaultParamList.map(x => toBN(x));
            await (ftsoManager.setGovernanceParameters as any)(...defaultParamListBN, [accounts[6], accounts[7]]);   

            await ftsoManager.addFtso(ftso1.address, { from: accounts[0] });
            await ftsoManager.addFtso(ftso2.address, { from: accounts[0] });

            await ftsoManager.activate();
            await ftsoManager.keep();

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.keep();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120 * 2));
            await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 2 + 30));
            let tx = await ftsoManager.keep();

            // Assert
            expectEvent(tx, "PriceEpochFinalized");

            epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120 * 3));
            tx = await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 3 + 30));
            tx = await ftsoManager.keep();

            expectEvent(tx, "PriceEpochFinalized");

            epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            let paramList = [1e10 + 1, 1e10 + 2, 1, 1 + 2, 1000, 10001, 50, 1500];
            let paramListBN = paramList.map(x => toBN(x));

            let trustedAddresses = [accounts[8], accounts[9]];
            await (ftsoManager.setGovernanceParameters as any)(...paramListBN, trustedAddresses);

            await time.increaseTo(startTs.addn(120 * 4));
            tx = await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 4 + 30));
            tx = await ftsoManager.keep();

            expectEvent(tx, "PriceEpochFinalized");

            let ftso1Params = numberedKeyedObjectToList(await ftso1.epochsConfiguration());
            let ftso2Params = numberedKeyedObjectToList(await ftso2.epochsConfiguration());

            let trustedAddresses1 = ftso1Params.pop();
            let trustedAddresses2 = ftso2Params.pop();

            assert(doBNListsMatch(paramListBN, ftso1Params as BN[]), "Wrong FTSO 1 governance parameters");
            assert(doBNListsMatch(paramListBN, ftso2Params as BN[]), "Wrong FTSO 2 governance parameters");
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
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            
            await time.increaseTo(startTs.addn(120));

            // Act
            // Simulate the keeper tickling reward manager
            let tx = await ftsoManager.keep();
            // Assert
            expectEvent(tx, "InitializingCurrentEpochStateForRevealFailed", {ftso: mockFtso.address, epochId: toBN(1)})

            const { 
                0: lastErrorBlockArr,
                1: numErrorsArr,
                2: errorStringArr,
                3: errorContractArr,
                4: totalKeptErrors
               } = await ftsoManager.showRevertedErrors(0, 1);

            assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[2].blockNumber);
            assert.equal(numErrorsArr[0].toNumber(), 1);
            assert.equal(errorStringArr[0], "I am broken");
            assert.equal(errorContractArr[0], ftsoManager.address);
            assert.equal(totalKeptErrors.toNumber(), 1);    
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
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

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

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling reward manager
            await ftsoManager.keep();

            // address[] memory addresses,
            // uint256[] memory weights,
            // uint256 totalWeight,
            // uint256 epochId,
            // address ftso,
            // uint256 priceEpochDurationSec,
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
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // address[] memory addresses,
            // uint256[] memory weights,
            // uint256 totalWeight,
            // uint256 epochId,
            // address ftso,
            // uint256 priceEpochDurationSec,
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
            // Simulate the keeper tickling reward manager
            let tx = await ftsoManager.keep();

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
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling reward manager
            await ftsoManager.keep();

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
            await ftsoManager.keep();

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.keep();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120 * 2));
            await ftsoManager.keep();

            await revealSomePrices(ftso1, 10, epoch.toNumber(), accounts);
            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(120 * 2 + 30));
            await ftsoManager.keep();

            let ftso1Events = await ftso1.getPastEvents("PriceFinalized")
            let ftso2Events = await ftso2.getPastEvents("PriceFinalized")
            assert.equal(lastOf(ftso1Events).args.finalizationType.toNumber(), 1);
            assert.equal(lastOf(ftso2Events).args.finalizationType.toNumber(), 1);


            // reveal only for ftso2, not ftso1
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(3 * 120));
            await ftsoManager.keep();

            await revealSomePrices(ftso2, 10, epoch.toNumber(), accounts);

            await time.increaseTo(startTs.addn(3 * 120 + 30));

            // finalize, ftso1 will force finalize
            await ftsoManager.keep();

            ftso1Events = await ftso1.getPastEvents("PriceFinalized");
            ftso2Events = await ftso2.getPastEvents("PriceFinalized");
            assert.equal(lastOf(ftso1Events).args.finalizationType.toNumber(), 3);
            assert.equal(lastOf(ftso2Events).args.finalizationType.toNumber(), 1);
        });

        it("Should emit event if finalize price epoch fails", async () => {
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
            await ftsoManager.keep();

            // Time travel 120 seconds
            await time.increaseTo(startTs.addn(120 + 30));

            // Act
            // Simulate the keeper tickling reward manager
            let tx = await ftsoManager.keep();

            // Assert
            expectEvent(tx, "FinalizingPriceEpochFailed", {ftso: mockFtso.address, epochId: toBN(0)})
        });
    });
    
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
            await settingWithOneFTSO_1(accounts, ftsoInterface, mockFtso, ftsoManager);
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
                    // time.increaseTo doesn't increase block number enough, so there is almost no space for random votePowerBlock (after we divide by 7)
                    for (let k = 0; k < 10; k++) {
                        await time.advanceBlock();
                    }
                    await ftsoManager.keep();
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
            await ftsoManager.keep();

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
            // Get the invocation count for setting new vote power block on mocked FTSO
            const setVotePowerBlock = web3.utils.sha3("setVotePowerBlock(uint256)")!.slice(0,10); // first 4 bytes is function selector
            const invocationCount = await mockFtso.invocationCountForMethod.call(setVotePowerBlock);
            // Should be 2 invocations; 1 during initializing first reward epoch, 1 during reward epoch finalization - for 1 FTSO
            assert.equal(invocationCount.toNumber(), 2);
        });

        it("Should emit event if close expired reward epochs fails", async () => {
            // Assemble
            // stub ftso initialize
            const closeExpiredRewardEpochs = ftsoRewardManagerInterface.contract.methods.closeExpiredRewardEpochs().encodeABI();
            await mockRewardManager.givenMethodRevertWithMessage(closeExpiredRewardEpochs,"I am broken");

            await setDefaultGovernanceParameters(ftsoManager);
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            
            await time.increaseTo(startTs.addn(172800)); // two days

            // Act
            // Simulate the keeper tickling reward manager
            let tx = await ftsoManager.keep();

            // Assert
            expectEvent(tx, "ClosingExpiredRewardEpochsFailed");
        });

        it("Should call distribute rewards with 0 remaining price epochs", async () => {
            let yearSeconds = 60 * 60 * 24 * 365; // 2021
            
            // longer reward and price epochs - time travel and calling keep()
            ftsoManager = await FtsoManager.new(
                accounts[0],
                accounts[0],
                mockRewardManager.address,
                accounts[7],
                ftsoRegistry.address,
                yearSeconds / 10,
                startTs,
                REVEAL_EPOCH_DURATION_S,
                yearSeconds,
                startTs,
                VOTE_POWER_BOUNDARY_FRACTION
            );

            ftsoRegistry.setFtsoManagerAddress(ftsoManager.address, {from: accounts[0]});

            // stub ftso randomizer
            const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
            await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
            // stub ftso finalizer
            const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(12, true).encodeABI();
            const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
                ['address[]', 'uint256[]', 'uint256'],
                [[accounts[1], accounts[2]], [25, 75], 100]);
            await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

            await setDefaultGovernanceParameters(ftsoManager);
            // add fakey ftso
            await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
            // activte ftso manager
            await ftsoManager.activate();
            await ftsoManager.keep();

            // Time travel
            for (let i = 1; i <= 13; i++) { // one year
                await time.increaseTo(startTs.addn(i * yearSeconds / 10));
                await ftsoManager.keep();
            }
            await time.increaseTo(startTs.addn(yearSeconds + 3 * yearSeconds / 10 + 30));
            await ftsoManager.keep();

            // Act
            // Simulate the keeper tickling reward manager
            await ftsoManager.keep();

            // address[] memory addresses,
            // uint256[] memory weights,
            // uint256 totalWeight,
            // uint256 epochId,
            // address ftso,
            // uint256 priceEpochDurationSec,
            // uint256 currentRewardEpoch
            const distributeRewards = ftsoRewardManagerInterface.contract.methods.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                12,
                mockFtso.address,
                yearSeconds / 10,
                1,
                startTs.addn((yearSeconds / 10 * 13) - 1),
                await ftsoManager.getRewardEpochVotePowerBlock(1)
            ).encodeABI();

            // Assert
            const invocationCountWithData = await mockRewardManager.invocationCountForCalldata.call(distributeRewards);
            assert.equal(invocationCountWithData.toNumber(), 1);
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
            await ftsoManager.keep();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.keep();

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
            await ftsoManager.keep();

            let epoch = await submitSomePrices(ftso1, 10, accounts);
            epoch = await submitSomePrices(ftso2, 10, accounts);

            await time.increaseTo(startTs.addn(120));
            await ftsoManager.keep();

            let report1 = await ftso1.getFullEpochReport(epoch.add(toBN(1)));
            expect(report1[12]).to.equals(true);

            let report2 = await ftso2.getFullEpochReport(epoch.add(toBN(1)));
            expect(report2[12]).to.equals(false);
        });
    });
});
