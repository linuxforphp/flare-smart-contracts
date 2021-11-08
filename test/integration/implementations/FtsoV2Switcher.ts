import { time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import {
    CleanupBlockNumberManagerInstance,
    FtsoInstance, FtsoManagerV1MockInstance,
    FtsoRegistryInstance,
    FtsoRewardManagerInstance, InflationMockInstance, MockContractInstance,
    PriceSubmitterInstance,
    TestableFlareDaemonInstance,
    VoterWhitelisterInstance,
    WNatInstance
} from "../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize } from "../../utils/constants";
import { createMockSupplyContract } from "../../utils/FTSO-test-utils";
import { setDefaultVPContract } from "../../utils/token-test-helpers";


const getTestFile = require('../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;

const BN = web3.utils.toBN;

const AddressUpdater = artifacts.require("AddressUpdater");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const VoterWhitelister = artifacts.require("VoterWhitelister");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const FlareDaemon = artifacts.require("TestableFlareDaemon");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const OldFtsoManager = artifacts.require("FtsoManagerV1Mock");
const FtsoManager = artifacts.require("FtsoManager");
const Ftso = artifacts.require("Ftso");
const WNAT = artifacts.require("WNat");
const InflationMock = artifacts.require("InflationMock");
const FtsoV2Switcher = artifacts.require("FtsoV2Switcher");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;
const FTSO_SYMBOL = "NAT";

contract(`FtsoV2Switcher.sol; ${ getTestFile(__filename) }; FtsoV2Switcher integration tests`, async accounts => {

    const governance = GOVERNANCE_GENESIS_ADDRESS;

    // contains a fresh contract for each test
    let priceSubmitter: PriceSubmitterInstance;
    let voterWhitelister: VoterWhitelisterInstance;
    let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;
    let flareDaemon: TestableFlareDaemonInstance;
    let ftsoRegistry: FtsoRegistryInstance;
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let oldFtsoManager: FtsoManagerV1MockInstance;
    let startTs: BN;
    let wNat: WNatInstance;
    let mockInflation: InflationMockInstance;
    let mockSupply: MockContractInstance;

    async function createFtso(ftsoManagerAddress: string): Promise<FtsoInstance> {
        return await Ftso.new(
            FTSO_SYMBOL,
            5,
            priceSubmitter.address,
            wNat.address,
            ftsoManagerAddress,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            0,
            1e10,
            defaultPriceEpochCyclicBufferSize,
            0
        );
    }

    beforeEach(async () => {
        priceSubmitter = await PriceSubmitter.new();
        await priceSubmitter.initialiseFixedAddress();
        voterWhitelister = await VoterWhitelister.new(governance, priceSubmitter.address, 10);
        cleanupBlockNumberManager = await CleanupBlockNumberManager.new(governance);
        flareDaemon = await FlareDaemon.new();
        await flareDaemon.initialiseFixedAddress();
        ftsoRegistry = await FtsoRegistry.new(governance);
        ftsoRewardManager = await FtsoRewardManager.new(
            governance,
            3,
            0
        );
        wNat = await WNAT.new(governance, "Wrapped NAT", "WNAT");

        mockInflation = await InflationMock.new();
        await mockInflation.setInflationReceiver(ftsoRewardManager.address);
        
        mockSupply = await createMockSupplyContract(governance, 10000);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        oldFtsoManager = await OldFtsoManager.new(
            governance,
            flareDaemon.address,
            ftsoRegistry.address,
            voterWhitelister.address,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S);
        
        await setDefaultVPContract(wNat, governance);
            
        await ftsoRegistry.setFtsoManagerAddress(oldFtsoManager.address, {from: governance});
        await voterWhitelister.setContractAddresses(ftsoRegistry.address, oldFtsoManager.address, {from: governance});
        await priceSubmitter.setContractAddresses(ftsoRegistry.address, voterWhitelister.address, oldFtsoManager.address, {from: governance});
        await ftsoRewardManager.setContractAddresses(mockInflation.address, oldFtsoManager.address, wNat.address, {from: governance});
        await cleanupBlockNumberManager.setTriggerContractAddress(oldFtsoManager.address, {from: governance});

        await mockInflation.setDailyAuthorizedInflation(BN(1000000));

        await ftsoRewardManager.activate({from: governance});

        const registrations = [
            { daemonizedContract: mockInflation.address, gasLimit: 2000000 },
            { daemonizedContract: oldFtsoManager.address, gasLimit: 40000000 }
        ];
        await flareDaemon.registerToDaemonize(registrations, {from: governance});
    });

    it("Should switch to ftso V2", async () => {
        // Assemble
        // add ftso to old ftso manager
        let oldFtso = await createFtso(oldFtsoManager.address);
        oldFtsoManager.addFtso(oldFtso.address, { from: governance });

        // Time travel to first reward epoch initialization time
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize first reward epoch

        // Time travel to second reward epoch
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + REWARD_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize second reward epoch
        
        
        // Act
        const deployerAccount = accounts[2];

        // create address updater and set governance to depoyer account
        const addressUpdater = await AddressUpdater.new(deployerAccount);

        // create new ftso manager, set governance to depoyer account and set also governance parameters
        const ftsoManager = await FtsoManager.new(
            deployerAccount,
            flareDaemon.address,
            addressUpdater.address,
            priceSubmitter.address,
            oldFtsoManager.address,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S,
            VOTE_POWER_BOUNDARY_FRACTION
        );
        await ftsoManager.setGovernanceParameters(10, 10, 500, 100000, 5000, 300, 50000, [], {from: deployerAccount});

        // set address updater data
        await addressUpdater.addOrUpdateContractNamesAndAddresses(
            [
                Contracts.ADDRESS_UPDATER, 
                Contracts.FTSO_REWARD_MANAGER, 
                Contracts.FTSO_REGISTRY, 
                Contracts.VOTER_WHITELISTER, 
                Contracts.SUPPLY, 
                Contracts.CLEANUP_BLOCK_NUMBER_MANAGER,
                Contracts.FLARE_DAEMON,
                Contracts.PRICE_SUBMITTER,
                Contracts.FTSO_MANAGER,
                Contracts.INFLATION,
                Contracts.WNAT
            ]
            ,
            [
                addressUpdater.address, 
                ftsoRewardManager.address, 
                ftsoRegistry.address, 
                voterWhitelister.address, 
                mockSupply.address, 
                cleanupBlockNumberManager.address,
                flareDaemon.address,
                priceSubmitter.address,
                ftsoManager.address,
                mockInflation.address,
                wNat.address

            ], {from: deployerAccount});


        // set contract addresses on ftso manager
        await addressUpdater.updateContractAddresses([ftsoManager.address], {from: deployerAccount});

        // create new ftso
        const newFtso = await createFtso(ftsoManager.address);
        // create switcher, set governance to depoyer account and set switcher data
        const ftsoV2Switcher = await FtsoV2Switcher.new(deployerAccount, addressUpdater.address);
        await ftsoV2Switcher.setFtsosToReplace([newFtso.address], {from: deployerAccount});
        const registrations = [
            { daemonizedContract: mockInflation.address, gasLimit: 2000000 },
            { daemonizedContract: ftsoManager.address, gasLimit: 40000000 }
        ];
        await ftsoV2Switcher.setFlareDaemonRegistrations(registrations, {from: deployerAccount});

        // transfer governance of contracts to switcher
        await ftsoManager.transferGovernance(ftsoV2Switcher.address, {from: deployerAccount});
        await cleanupBlockNumberManager.transferGovernance(ftsoV2Switcher.address, {from: governance});
        await priceSubmitter.transferGovernance(ftsoV2Switcher.address, {from: governance});
        await flareDaemon.transferGovernance(ftsoV2Switcher.address, {from: governance});
        await ftsoRewardManager.transferGovernance(ftsoV2Switcher.address, {from: governance});
        await voterWhitelister.transferGovernance(ftsoV2Switcher.address, {from: governance});
        await ftsoRegistry.transferGovernance(ftsoV2Switcher.address, {from: governance});

        // transfer governance
        await addressUpdater.transferGovernance(governance, {from: deployerAccount});
        await ftsoV2Switcher.transferGovernance(governance, {from: deployerAccount});

        // call switch method
        await ftsoV2Switcher.switchToFtsoV2(oldFtsoManager.address, {from: governance});

        // Assert
        expect(await ftsoManager.governance()).to.equals(governance);
        expect(await flareDaemon.governance()).to.equals(governance);
        expect(await ftsoRegistry.governance()).to.equals(governance);
        expect(await ftsoRewardManager.governance()).to.equals(governance);
        expect(await cleanupBlockNumberManager.governance()).to.equals(governance);
        expect(await voterWhitelister.governance()).to.equals(governance);
        expect(await priceSubmitter.governance()).to.equals(governance);

        expect(await ftsoRegistry.getFtsoBySymbol(FTSO_SYMBOL)).to.equals(newFtso.address);
        expect((await ftsoRegistry.getFtsoIndex(FTSO_SYMBOL)).toString()).to.equals('0');
        expect(await oldFtso.active()).to.be.true;
        expect(await newFtso.active()).to.be.true;
        
        expect((await flareDaemon.getDaemonizedContractsData())[0][0]).to.equals(mockInflation.address);
        expect((await flareDaemon.getDaemonizedContractsData())[0][1]).to.equals(ftsoManager.address);

        expect(await priceSubmitter.getFtsoManager()).to.equals(ftsoManager.address);
        expect(await ftsoRegistry.ftsoManager()).to.equals(ftsoManager.address);
        expect(await ftsoRewardManager.ftsoManager()).to.equals(ftsoManager.address);
        expect(await voterWhitelister.ftsoManager()).to.equals(ftsoManager.address);
        expect(await cleanupBlockNumberManager.triggerContract()).to.equals(ftsoManager.address);

        expect((await oldFtsoManager.rewardEpochs(0))[0].toString()).to.equals((await ftsoManager.getRewardEpochData(0)).votepowerBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(0))[1].toString()).to.equals((await ftsoManager.getRewardEpochData(0)).startBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(0))[2].toString()).to.equals((await ftsoManager.getRewardEpochData(0)).startTimestamp.toString());

        expect((await oldFtsoManager.rewardEpochs(1))[0].toString()).to.equals((await ftsoManager.getRewardEpochData(1)).votepowerBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(1))[1].toString()).to.equals((await ftsoManager.getRewardEpochData(1)).startBlock.toString());
        expect((await oldFtsoManager.rewardEpochs(1))[2].toString()).to.equals((await ftsoManager.getRewardEpochData(1)).startTimestamp.toString());


        // Time travel to third reward epoch
        await time.increaseTo(startTs.addn(REVEAL_EPOCH_DURATION_S + 2 * REWARD_EPOCH_DURATION_S));
        await flareDaemon.trigger(); // initialize third reward epoch

        expect(BN((await ftsoManager.getRewardEpochData(2)).votepowerBlock.toString()).toNumber()).to.be.gt(BN((await ftsoManager.getRewardEpochData(1)).votepowerBlock.toString()).toNumber());
        expect(BN((await ftsoManager.getRewardEpochData(2)).startBlock.toString()).toNumber()).to.be.gt(BN((await ftsoManager.getRewardEpochData(1)).startBlock.toString()).toNumber());
        expect(BN((await ftsoManager.getRewardEpochData(2)).startTimestamp.toString()).toNumber()).to.be.gt(BN((await ftsoManager.getRewardEpochData(1)).startTimestamp.toString()).toNumber());

        expect((await ftsoManager.currentRewardEpochEnds()).toNumber()).to.equals(startTs.addn(REVEAL_EPOCH_DURATION_S + 3 * REWARD_EPOCH_DURATION_S).toNumber());
        expect(await ftsoManager.active()).to.be.true;
    });
});
