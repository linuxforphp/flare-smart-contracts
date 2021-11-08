import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import {
    AddressUpdaterInstance, FtsoManagerInstance, FtsoManagerV1MockInstance, FtsoRewardManagerInstance, FtsoV2SwitcherInstance
} from "../../../../typechain-truffle";
import { getTestFile, GOVERNANCE_GENESIS_ADDRESS } from "../../../utils/constants";
import { compareArrays } from '../../../utils/test-helpers';

const Governed = artifacts.require("Governed");
const MockContract = artifacts.require("MockContract");
const AddressUpdater = artifacts.require("AddressUpdater");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const VoterWhitelister = artifacts.require("VoterWhitelister");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const FlareDaemon = artifacts.require("TestableFlareDaemon");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const OldFtsoManager = artifacts.require("FtsoManagerV1Mock");
const FtsoManager = artifacts.require("FtsoManager");
const FtsoV2Switcher = artifacts.require("FtsoV2Switcher");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

contract(`FtsoV2Switcher.sol; ${ getTestFile(__filename) }; FtsoV2Switcher unit tests`, async accounts => {

    const governance = GOVERNANCE_GENESIS_ADDRESS;
    let startTs: BN;
    let addressUpdater: AddressUpdaterInstance;
    let ftsoV2Switcher: FtsoV2SwitcherInstance;
    
    let ftsoManagerInterface: FtsoManagerInstance;
    let oldFtsoManagerInterface: FtsoManagerV1MockInstance;
    let ftsoRewardManagerInterface: FtsoRewardManagerInstance;

    beforeEach(async () => {
        addressUpdater = await AddressUpdater.new(governance);
        ftsoV2Switcher = await FtsoV2Switcher.new(governance, addressUpdater.address);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoManagerInterface = await FtsoManager.new(
            governance,
            accounts[0],
            accounts[0],
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        oldFtsoManagerInterface = await OldFtsoManager.new(
            governance,
            accounts[0],
            constants.ZERO_ADDRESS,
            constants.ZERO_ADDRESS,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S);

        ftsoRewardManagerInterface = await FtsoRewardManager.new(
            governance,
            3,
            2000
        )
    });

    it("Should know about governance", async () => {
        // Assemble
        // Act
        // Assert
        assert.equal(await ftsoV2Switcher.governance(), governance);
    });

    it("Should set registrations", async() => {
        // Assemble
        const registrations = [
            { daemonizedContract: accounts[1], gasLimit: 2000000 },
            { daemonizedContract: accounts[2], gasLimit: 40000000 }
        ];
        // Act
        await ftsoV2Switcher.setFlareDaemonRegistrations(registrations, { from: governance });
        // Assert

        const reg = await ftsoV2Switcher.getFlareDaemonRegistrations();
        assert.equal(reg.length, registrations.length);
        assert.equal(reg[0].daemonizedContract, registrations[0].daemonizedContract);
        assert.equal(reg[0].gasLimit.toString(), registrations[0].gasLimit.toString());
        assert.equal(reg[1].daemonizedContract, registrations[1].daemonizedContract);
        assert.equal(reg[1].gasLimit.toString(), registrations[1].gasLimit.toString());
    });

    it("Should revert setting registrations if not from governance", async() => {
        // Assemble
        // Act
        const setPromise = ftsoV2Switcher.setFlareDaemonRegistrations([], { from: accounts[0] });
        // Assert
        await expectRevert(setPromise, "only governance")
    });

    it("Should set ftsos", async() => {
        // Assemble
        const ftsos = [accounts[1], accounts[2]];
        // Act
        await ftsoV2Switcher.setFtsosToReplace(ftsos, { from: governance });
        // Assert
        compareArrays(await ftsoV2Switcher.getFtsosToReplace(), ftsos);
    });

    it("Should revert setting ftsos if not from governance", async() => {
        // Assemble
        // Act
        const setPromise = ftsoV2Switcher.setFtsosToReplace([], { from: accounts[0] });
        // Assert
        await expectRevert(setPromise, "only governance")
    });

    it("Should transfer governance back", async() => {
        // Assemble
        const governedContract = await Governed.new(ftsoV2Switcher.address);
        // Act
        await ftsoV2Switcher.transferGovernanceBack([governedContract.address], { from: governance });
        // Assert
        assert.equal(await governedContract.governance(), governance)
    });
    
    it("Should revert calling transfer governance back if not from governance", async() => {
        // Assemble
        // Act
        const transferPromise = ftsoV2Switcher.transferGovernanceBack([], { from: accounts[0] });
        // Assert
        await expectRevert(transferPromise, "only governance")
    });

    it("Should revert calling switch if not from governance", async() => {
        // Assemble
        // Act
        const switchPromise = ftsoV2Switcher.switchToFtsoV2(constants.ZERO_ADDRESS, { from: accounts[0] });
        // Assert
        await expectRevert(switchPromise, "only governance")
    });

    it("Should revert calling switch if ftsos are not set", async() => {
        // Assemble
        // Act
        const switchPromise = ftsoV2Switcher.switchToFtsoV2(constants.ZERO_ADDRESS, { from: governance });
        // Assert
        await expectRevert(switchPromise, "ftsos not set")
    });

    it("Should revert calling switch if registrants are not set", async() => {
        // Assemble
        const ftsos = [accounts[1], accounts[2]];
        await ftsoV2Switcher.setFtsosToReplace(ftsos, { from: governance });
        // Act
        const switchPromise = ftsoV2Switcher.switchToFtsoV2(constants.ZERO_ADDRESS, { from: governance });
        // Assert
        await expectRevert(switchPromise, "registrations not set")
    });

    it("Should revert calling switch if contracts on address updater are not set", async() => {
        // Assemble
        const ftsos = [accounts[1], accounts[2]];
        await ftsoV2Switcher.setFtsosToReplace(ftsos, { from: governance });
        const registrations = [
            { daemonizedContract: accounts[1], gasLimit: 2000000 },
            { daemonizedContract: accounts[2], gasLimit: 40000000 }
        ];
        await ftsoV2Switcher.setFlareDaemonRegistrations(registrations, { from: governance });
        // Act
        const switchPromise = ftsoV2Switcher.switchToFtsoV2(constants.ZERO_ADDRESS, { from: governance });
        // Assert
        await expectRevert(switchPromise, "address zero")
    });

    it("Should revert calling switch if reward epoch start does not match", async() => {
        // Assemble
        const oldFtsoManagerMock = await MockContract.new();
        const ftsoManagerMock = await MockContract.new();

        // Rig the expected return using web3 abi encoder
        const rewardEpochsStartTs = oldFtsoManagerInterface.contract.methods.rewardEpochsStartTs().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs.addn(1));

        const getRewardEpochConfiguration = ftsoManagerInterface.contract.methods.getRewardEpochConfiguration().encodeABI();
        const getRewardEpochConfigurationReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [startTs, 0]);
        await ftsoManagerMock.givenMethodReturn(getRewardEpochConfiguration, getRewardEpochConfigurationReturn);

        await addressUpdater.addOrUpdateContractNamesAndAddresses(["FtsoManager"], [ftsoManagerMock.address], { from: governance });
        const ftsos = [accounts[1], accounts[2]];
        await ftsoV2Switcher.setFtsosToReplace(ftsos, { from: governance });
        const registrations = [
            { daemonizedContract: accounts[1], gasLimit: 2000000 },
            { daemonizedContract: accounts[2], gasLimit: 40000000 }
        ];
        await ftsoV2Switcher.setFlareDaemonRegistrations(registrations, { from: governance });
        // Act
        const switchPromise = ftsoV2Switcher.switchToFtsoV2(oldFtsoManagerMock.address, { from: governance });
        // Assert
        await expectRevert(switchPromise, "reward epoch start does not match")
    });

    it("Should switch successfully", async() => {
        // Assemble
        const priceSubmitterInterface = await PriceSubmitter.new();
        const voterWhitelisterInterface = await VoterWhitelister.new(governance, priceSubmitterInterface.address, 100);
        const ftsoRegistryInterface = await FtsoRegistry.new(governance);
        const cleanupBlockNumberManagerInterface = await CleanupBlockNumberManager.new(governance);
        const flareDaemonInterface = await FlareDaemon.new();

        const oldFtsoManagerMock = await MockContract.new();
        const ftsoManagerMock = await MockContract.new();
        const priceSubmitterMock = await MockContract.new();
        const ftsoRewardManagerMock = await MockContract.new();
        const ftsoRegistryMock = await MockContract.new();
        const voterWhitelisterMock = await MockContract.new();
        const cleanupBlockNumberManagerMock = await MockContract.new();
        const flareDaemonMock = await MockContract.new();
        const inflationMock = await MockContract.new();
        const wNatMock = await MockContract.new();

        // Rig the expected return using web3 abi encoder
        const rewardEpochsStartTs = oldFtsoManagerInterface.contract.methods.rewardEpochsStartTs().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochsStartTs, startTs);
        const rewardEpochDurationSeconds = oldFtsoManagerInterface.contract.methods.rewardEpochDurationSeconds().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(rewardEpochDurationSeconds, REWARD_EPOCH_DURATION_S);
        const getCurrentRewardEpoch = oldFtsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
        await oldFtsoManagerMock.givenMethodReturnUint(getCurrentRewardEpoch, 100);

        const getRewardEpochConfiguration = ftsoManagerInterface.contract.methods.getRewardEpochConfiguration().encodeABI();
        const getRewardEpochConfigurationReturn = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [startTs, 0]);
        await ftsoManagerMock.givenMethodReturn(getRewardEpochConfiguration, getRewardEpochConfigurationReturn);

        const getRewardEpochToExpireNext = ftsoRewardManagerInterface.contract.methods.getRewardEpochToExpireNext().encodeABI();
        await ftsoRewardManagerMock.givenMethodReturnUint(getRewardEpochToExpireNext, 5);

        // set address updater data
        await addressUpdater.addOrUpdateContractNamesAndAddresses(
            ["FtsoManager", "PriceSubmitter", "FtsoRewardManager", "FtsoRegistry", "VoterWhitelister", "CleanupBlockNumberManager", "FlareDaemon", "Inflation", "WNat"],
            [ftsoManagerMock.address, priceSubmitterMock.address, ftsoRewardManagerMock.address, ftsoRegistryMock.address, voterWhitelisterMock.address, cleanupBlockNumberManagerMock.address, flareDaemonMock.address, inflationMock.address, wNatMock.address], 
            { from: governance });

        // set switcher data
        const ftsos = [accounts[1], accounts[2]];
        await ftsoV2Switcher.setFtsosToReplace(ftsos, { from: governance });
        const registrations = [
            { daemonizedContract: accounts[1], gasLimit: 2000000 },
            { daemonizedContract: accounts[2], gasLimit: 40000000 }
        ];
        await ftsoV2Switcher.setFlareDaemonRegistrations(registrations, { from: governance });

        // Act
        await ftsoV2Switcher.switchToFtsoV2(oldFtsoManagerMock.address, { from: governance });

        // Assert
        // set new addresses
        let setAddresses = priceSubmitterInterface.contract.methods.setContractAddresses(ftsoRegistryMock.address, voterWhitelisterMock.address, ftsoManagerMock.address).encodeABI();
        assert.equal((await priceSubmitterMock.invocationCountForCalldata.call(setAddresses)).toNumber(), 1);

        setAddresses = ftsoRewardManagerInterface.contract.methods.setContractAddresses(inflationMock.address, ftsoManagerMock.address, wNatMock.address).encodeABI();
        assert.equal((await ftsoRewardManagerMock.invocationCountForCalldata.call(setAddresses)).toNumber(), 1);
        
        setAddresses = ftsoRegistryInterface.contract.methods.setFtsoManagerAddress(ftsoManagerMock.address).encodeABI();
        assert.equal((await ftsoRegistryMock.invocationCountForCalldata.call(setAddresses)).toNumber(), 1);

        setAddresses = voterWhitelisterInterface.contract.methods.setContractAddresses(ftsoRegistryMock.address, ftsoManagerMock.address).encodeABI();
        assert.equal((await voterWhitelisterMock.invocationCountForCalldata.call(setAddresses)).toNumber(), 1);

        setAddresses = cleanupBlockNumberManagerInterface.contract.methods.setTriggerContractAddress(ftsoManagerMock.address).encodeABI();
        assert.equal((await cleanupBlockNumberManagerMock.invocationCountForCalldata.call(setAddresses)).toNumber(), 1);

        // set initial reward data
        const setInitialRewardData = ftsoManagerInterface.contract.methods.setInitialRewardData(5, 101, startTs.addn(101 * REWARD_EPOCH_DURATION_S)).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(setInitialRewardData)).toNumber(), 1);

        // activate
        const activate = ftsoManagerInterface.contract.methods.activate().encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(activate)).toNumber(), 1);

        // replace ftsos
        const replaceFtsosBulk = ftsoManagerInterface.contract.methods.replaceFtsosBulk(ftsos, true, false).encodeABI();
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(replaceFtsosBulk)).toNumber(), 1);

        // register to daemonize
        const registerToDaemonize = flareDaemonInterface.contract.methods.registerToDaemonize(registrations).encodeABI();
        assert.equal((await flareDaemonMock.invocationCountForCalldata.call(registerToDaemonize)).toNumber(), 1);

        // transfer governance back
        const transferGovernance = ftsoV2Switcher.contract.methods.transferGovernance(governance).encodeABI(); // all encoded calls are the same
        assert.equal((await ftsoManagerMock.invocationCountForCalldata.call(transferGovernance)).toNumber(), 1);
        assert.equal((await priceSubmitterMock.invocationCountForCalldata.call(transferGovernance)).toNumber(), 1);
        assert.equal((await ftsoRewardManagerMock.invocationCountForCalldata.call(transferGovernance)).toNumber(), 1);
        assert.equal((await ftsoRegistryMock.invocationCountForCalldata.call(transferGovernance)).toNumber(), 1);
        assert.equal((await voterWhitelisterMock.invocationCountForCalldata.call(transferGovernance)).toNumber(), 1);
        assert.equal((await cleanupBlockNumberManagerMock.invocationCountForCalldata.call(transferGovernance)).toNumber(), 1);
        assert.equal((await flareDaemonMock.invocationCountForCalldata.call(transferGovernance)).toNumber(), 1);
    });
});
