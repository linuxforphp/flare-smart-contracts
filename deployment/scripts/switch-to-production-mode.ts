import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

type Account = ReturnType<typeof web3.eth.accounts.privateKeyToAccount>;

export async function switchToProductionMode(
    hre: HardhatRuntimeEnvironment,
    contracts: Contracts,
    deployerPrivateKey: string,
    genesisGovernancePrivateKey: string,
    distributionDeployed: boolean,
    quiet: boolean = false
) {
    const web3 = hre.web3;
    const artifacts = hre.artifacts as Truffle.Artifacts;

    // Turn over governance
    if (!quiet) {
        console.error("Switching to production mode...");
    }

    // Define accounts in play for the deployment process
    let deployerAccount: Account;
    let genesisGovernanceAccount: Account;

    // Get deployer account
    try {
        deployerAccount = web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
    } catch (e) {
        throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
    }

    // Get deployer account
    try {
        genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(genesisGovernancePrivateKey);
    } catch (e) {
        throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
    }


    if (!quiet) {
        console.error(`Switching to production from deployer address ${deployerAccount.address} and genesis governance address ${genesisGovernanceAccount.address}`);
        console.error(`Using governance settings at ${contracts.getContractAddress(Contracts.GOVERNANCE_SETTINGS)}`);
    }

    // Wire up the default account that will do the deployment
    web3.eth.defaultAccount = deployerAccount.address;

    // Contract definitions
    const GovernanceSettings = artifacts.require("GovernanceSettings");
    const AddressUpdater = artifacts.require("AddressUpdater");
    const InflationAllocation = artifacts.require("InflationAllocation");
    const FlareDaemon = artifacts.require("FlareDaemon");
    const FtsoManager = artifacts.require("FtsoManager");
    const Inflation = artifacts.require("Inflation");
    const FtsoRewardManager = artifacts.require("FtsoRewardManager");
    const PriceSubmitter = artifacts.require("PriceSubmitter");
    const Supply = artifacts.require("Supply");
    const VoterWhitelister = artifacts.require("VoterWhitelister");
    const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
    const DistributionTreasury = artifacts.require("DistributionTreasury");
    const Distribution = artifacts.require("Distribution");
    const DistributionToDelegators = artifacts.require("DistributionToDelegators");
    const IncentivePoolTreasury = artifacts.require("IncentivePoolTreasury");
    const IncentivePool = artifacts.require("IncentivePool");
    const IncentivePoolAllocation = artifacts.require("IncentivePoolAllocation");
    const InitialAirdrop = artifacts.require("InitialAirdrop");
    const FtsoRegistry = artifacts.require("FtsoRegistry");
    const WNat = artifacts.require("WNat");
    const Escrow = artifacts.require("Escrow");
    const DelegationAccountManager = artifacts.require("DelegationAccountManager");

    // Get deployed contracts
    const governanceSettings = await GovernanceSettings.at(contracts.getContractAddress(Contracts.GOVERNANCE_SETTINGS));
    const addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    const supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
    const inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
    const inflationAllocation = await InflationAllocation.at(contracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
    const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    const ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    const priceSubmitter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    const voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    const cleanupBlockNumberManager = await CleanupBlockNumberManager.at(contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
    const distributionTreasury = await DistributionTreasury.at(contracts.getContractAddress(Contracts.DISTRIBUTION_TREASURY));
    const incentivePoolTreasury = await IncentivePoolTreasury.at(contracts.getContractAddress(Contracts.INCENTIVE_POOL_TREASURY));
    const incentivePool = await IncentivePool.at(contracts.getContractAddress(Contracts.INCENTIVE_POOL));
    const incentivePoolAllocation = await IncentivePoolAllocation.at(contracts.getContractAddress(Contracts.INCENTIVE_POOL_ALLOCATION));
    const initialAirdrop = await InitialAirdrop.at(contracts.getContractAddress(Contracts.INITIAL_AIRDROP));
    const ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    const wNat = await WNat.at(contracts.getContractAddress(Contracts.WNAT));
    const escrow = await Escrow.at(contracts.getContractAddress(Contracts.ESCROW));

    // switch to production mode
    await flareDaemon.switchToProductionMode({ from: genesisGovernanceAccount.address });
    await priceSubmitter.switchToProductionMode({ from: genesisGovernanceAccount.address });
    await distributionTreasury.switchToProductionMode({ from: genesisGovernanceAccount.address });
    await incentivePoolTreasury.switchToProductionMode({ from: genesisGovernanceAccount.address });
    await initialAirdrop.switchToProductionMode({ from: genesisGovernanceAccount.address });
    await addressUpdater.switchToProductionMode();
    await supply.switchToProductionMode();
    await inflation.switchToProductionMode();
    await inflationAllocation.switchToProductionMode();
    await ftsoRewardManager.switchToProductionMode();
    if (distributionDeployed) {
        const distribution = await Distribution.at(contracts.getContractAddress(Contracts.DISTRIBUTION));
        const distributionToDelegators = await DistributionToDelegators.at(contracts.getContractAddress(Contracts.DISTRIBUTION_TO_DELEGATORS));
        await distribution.switchToProductionMode();
        await distributionToDelegators.switchToProductionMode();
        const delegationAccountManager = await DelegationAccountManager.at(contracts.getContractAddress(Contracts.DELEGATION_ACCOUNT_MANAGER));
        await delegationAccountManager.switchToProductionMode();
    }
    await incentivePool.switchToProductionMode();
    await incentivePoolAllocation.switchToProductionMode();
    await ftsoManager.switchToProductionMode();
    await voterWhitelister.switchToProductionMode();
    await cleanupBlockNumberManager.switchToProductionMode();
    await ftsoRegistry.switchToProductionMode();
    await wNat.switchToProductionMode();
    await escrow.switchToProductionMode();
}
