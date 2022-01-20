import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

export async function claimGovernance(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  governanceClaimaintPrivateKey: string,
  distributionDeployed: boolean,
  quiet: boolean = false) {

  const web3 = hre.web3;
  const artifacts = hre.artifacts;

  // Claim governance
  if (!quiet) {
    console.error("Claiming governance...");
  }

  // Define accounts in play
  let claimantAccount: any;

  // Get deployer account
  try {
    claimantAccount = web3.eth.accounts.privateKeyToAccount(governanceClaimaintPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will dothe claiming
  web3.eth.defaultAccount = claimantAccount.address;

  if (!quiet) {
    console.error(`Claiming governance with address ${claimantAccount.address}`)
  }
  
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
  const ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));
  const wNat = await WNat.at(contracts.getContractAddress(Contracts.WNAT));

  // Claim
  await addressUpdater.claimGovernance({from: claimantAccount.address});
  await supply.claimGovernance({from: claimantAccount.address});
  await inflation.claimGovernance({from: claimantAccount.address});
  await inflationAllocation.claimGovernance({from: claimantAccount.address});
  await flareDaemon.claimGovernance({from: claimantAccount.address});
  await ftsoRewardManager.claimGovernance({from: claimantAccount.address});
  if (distributionDeployed) {
    const distribution = await Distribution.at(contracts.getContractAddress(Contracts.DISTRIBUTION));
    await distribution.claimGovernance({from: claimantAccount.address});
  }
  await ftsoManager.claimGovernance({from: claimantAccount.address});
  await priceSubmitter.claimGovernance({from: claimantAccount.address});
  await voterWhitelister.claimGovernance({from: claimantAccount.address});
  await cleanupBlockNumberManager.claimGovernance({from: claimantAccount.address});
  await ftsoRegistry.claimGovernance({from: claimantAccount.address});
  await wNat.claimGovernance({from: claimantAccount.address});
}