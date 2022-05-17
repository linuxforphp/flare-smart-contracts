import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

export async function proposeGovernance(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  deployerPrivateKey: string, 
  genesisGovernancePrivateKey: string,
  newGovernanceAccountAddress: string,
  distributionDeployed: boolean,
  quiet: boolean = false) {

  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  
  // Turn over governance
  if (!quiet) {
    console.error("Proposing governance...");
  }

  // Define accounts in play for the deployment process
  let deployerAccount: any;

  // Get deployer account
  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  if (!quiet) {
    console.error(`Proposing with address ${deployerAccount.address}`)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;
  
  // Contract definitions
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
  const FtsoRegistry = artifacts.require("FtsoRegistry");
  const WNat = artifacts.require("WNat");

  // Get deployed contracts
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
  const ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY)); 
  const wNat = await WNat.at(contracts.getContractAddress(Contracts.WNAT));

  if (!quiet) {
    console.error(`Proposed address is ${newGovernanceAccountAddress}`);
  }

  // Propose
  await addressUpdater.proposeGovernance(newGovernanceAccountAddress);
  await supply.proposeGovernance(newGovernanceAccountAddress);
  await inflation.proposeGovernance(newGovernanceAccountAddress);
  await inflationAllocation.proposeGovernance(newGovernanceAccountAddress);
  await flareDaemon.proposeGovernance(newGovernanceAccountAddress);
  await ftsoRewardManager.proposeGovernance(newGovernanceAccountAddress);
  if (distributionDeployed) {
    const distribution = await Distribution.at(contracts.getContractAddress(Contracts.DISTRIBUTION));
    await distribution.proposeGovernance(newGovernanceAccountAddress);
  }
  await ftsoManager.proposeGovernance(newGovernanceAccountAddress);
  await priceSubmitter.proposeGovernance(newGovernanceAccountAddress);
  await voterWhitelister.proposeGovernance(newGovernanceAccountAddress);
  await cleanupBlockNumberManager.proposeGovernance(newGovernanceAccountAddress);
  await distributionTreasury.proposeGovernance(newGovernanceAccountAddress);
  await ftsoRegistry.proposeGovernance(newGovernanceAccountAddress);
  await wNat.proposeGovernance(newGovernanceAccountAddress);
}