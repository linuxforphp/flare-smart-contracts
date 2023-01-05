/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import {
  ClaimSetupManagerContract, DelegationAccountContract, FlareAssetRegistryContract, FtsoContract, FtsoInstance, FtsoManagerContract, FtsoRegistryContract, FtsoRegistryProxyContract, FtsoRewardManagerContract, InitialAirdropContract, PollingFoundationContract, ValidatorRewardManagerContract, WNatRegistryProviderContract
} from '../../typechain-truffle';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import {
  AssetContracts, DeployedFlareContracts, rewrapXassetParams, spewNewContractInfo,
  verifyParameters
} from './deploy-utils';


export async function redeployContracts(hre: HardhatRuntimeEnvironment, contracts: Contracts, parameters: ChainParameters, quiet: boolean = false) {
  
  function encodeContractNames(names: string[]): string[] {
    return names.map( name => encodeString(name) );
  }

  function encodeString(text: string): string {
    return hre.ethers.utils.keccak256(hre.ethers.utils.defaultAbiCoder.encode(["string"], [text]));
  }


  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;


  verifyParameters(parameters);
  // Define accounts in play for the deployment process
  let deployerAccount: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const Ftso: FtsoContract = artifacts.require("Ftso");
  const FtsoManager: FtsoManagerContract = artifacts.require("FtsoManager");
  const FtsoRegistry: FtsoRegistryContract = artifacts.require("FtsoRegistry");
  const FtsoRegistryProxy: FtsoRegistryProxyContract = artifacts.require("FtsoRegistryProxy");
  const FtsoRewardManager: FtsoRewardManagerContract = artifacts.require("FtsoRewardManager");
  const DelegationAccount: DelegationAccountContract = artifacts.require("DelegationAccount");
  const ClaimSetupManager: ClaimSetupManagerContract = artifacts.require("ClaimSetupManager");
  const ValidatorRewardManager: ValidatorRewardManagerContract = artifacts.require("ValidatorRewardManager");
  const FlareAssetRegistry: FlareAssetRegistryContract = artifacts.require("FlareAssetRegistry");
  const InitialAirdrop: InitialAirdropContract = artifacts.require("InitialAirdrop");
  const WNatRegistryProvider: WNatRegistryProviderContract = artifacts.require("WNatRegistryProvider");
  const PollingFoundation: PollingFoundationContract = artifacts.require("PollingFoundation");

  // old contract addresses
  const flareDaemonAddress = contracts.getContractAddress(Contracts.FLARE_DAEMON);
  const priceSubmitterAddress = contracts.getContractAddress(Contracts.PRICE_SUBMITTER);
  const addressUpdaterAddress = contracts.getContractAddress(Contracts.ADDRESS_UPDATER);
  const voterWhitelisterAddress = contracts.getContractAddress(Contracts.VOTER_WHITELISTER);
  const supplyAddress = contracts.getContractAddress(Contracts.SUPPLY);
  const cleanupBlockNumberManagerAddress = contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER);
  const inflationAddress = contracts.getContractAddress(Contracts.INFLATION);
  const wNatAddress = contracts.getContractAddress(Contracts.WNAT);
  const governanceVotePowerAddress = contracts.getContractAddress(Contracts.GOVERNANCE_VOTE_POWER);

  // FlareAssetRegistry contract
  const flareAssetRegistry = await FlareAssetRegistry.new(deployerAccount.address);
  spewNewContractInfo(contracts, null, FlareAssetRegistry.contractName, `FlareAssetRegistry.sol`, flareAssetRegistry.address, quiet);

  // WNatRegistryProvider contract
  const wNatRegistryProvider = await WNatRegistryProvider.new(addressUpdaterAddress, flareAssetRegistry.address);
  await flareAssetRegistry.registerProvider(wNatRegistryProvider.address, true);
  spewNewContractInfo(contracts, null, WNatRegistryProvider.contractName, `WNatRegistryProvider.sol`, wNatRegistryProvider.address, quiet);

  // InitialAirdrop contract
  const initialAirdrop = await InitialAirdrop.new(deployerAccount.address);
  spewNewContractInfo(contracts, null, InitialAirdrop.contractName, `InitialAirdrop.sol`, initialAirdrop.address, quiet);

  // ValidatorRewardManager contract
  const validatorRewardManager = await ValidatorRewardManager.new(
    deployerAccount.address,
    deployerAccount.address,
    "0x0000000000000000000000000000000000000000"
  );
  spewNewContractInfo(contracts, null, ValidatorRewardManager.contractName, `ValidatorRewardManager.sol`, validatorRewardManager.address, quiet);

  // Deploy polling foundation
  const pollingFoundation = await PollingFoundation.new(
    deployerAccount.address,
    parameters.priceSubmitterAddress,
    deployerAccount.address, // deployerAccount.address temp as addressUpdater
    parameters.proposers
  );
  spewNewContractInfo(contracts, null, PollingFoundation.contractName, `PollingFoundation.sol`, pollingFoundation.address, quiet);

  // FtsoRewardManager contract (must link with library first)
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    deployerAccount.address, // deployerAccount.address temp as addressUpdater
    contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER), // old ftso reward manager
    parameters.rewardFeePercentageUpdateOffsetEpochs,
    parameters.defaultRewardFeePercentageBIPS);
  spewNewContractInfo(contracts, null, FtsoRewardManager.contractName, `FtsoRewardManager.sol`, ftsoRewardManager.address, quiet);

  // FtsoRegistry contract
  const ftsoRegistryImplementation = await FtsoRegistry.new();
  const ftsoRegistryProxy = await FtsoRegistryProxy.new(deployerAccount.address, ftsoRegistryImplementation.address);
  const ftsoRegistry = await FtsoRegistry.at(ftsoRegistryProxy.address); 
  await ftsoRegistry.initialiseRegistry(deployerAccount.address); // deployerAccount.address temp as addressUpdater
  spewNewContractInfo(contracts, null, FtsoRegistry.contractName, `FtsoRegistry.sol`, ftsoRegistry.address, quiet);
  
  // ClaimSetupManager contract
  const claimSetupManager = await ClaimSetupManager.new(
    deployerAccount.address,
    deployerAccount.address, // deployerAccount.address temp as addressUpdater
    parameters.executorFeeValueUpdateOffsetEpochs,
    BN(parameters.executorMinFeeValueWei.replace(/\s/g, '')),
    BN(parameters.executorMaxFeeValueNAT).mul(BN(10).pow(BN(18))),
    BN(parameters.executorRegisterFeeValueNAT).mul(BN(10).pow(BN(18)))
  );
  spewNewContractInfo(contracts, null, ClaimSetupManager.contractName, `ClaimSetupManager.sol`, claimSetupManager.address, quiet);

  const delegationAccount = await DelegationAccount.new();
  spewNewContractInfo(contracts, null, DelegationAccount.contractName, `DelegationAccount.sol`, delegationAccount.address, quiet);
  await delegationAccount.initialize(claimSetupManager.address, claimSetupManager.address);
  await claimSetupManager.setLibraryAddress(delegationAccount.address);

  const oldFtsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
  const ftsoStartTs = (await oldFtsoManager.getPriceEpochConfiguration())[0];
  const rewardEpochsStartTs = await oldFtsoManager.rewardEpochsStartTs();

  // FtsoManager contract (must link with library first)
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareDaemonAddress,
    deployerAccount.address, // deployerAccount.address temp as addressUpdater
    priceSubmitterAddress,
    contracts.getContractAddress(Contracts.FTSO_MANAGER), // old ftso manager
    ftsoStartTs,
    parameters.priceEpochDurationSeconds,
    parameters.revealEpochDurationSeconds,
    rewardEpochsStartTs,
    parameters.rewardEpochDurationSeconds,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, null, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  let assetToContracts = new Map<string, AssetContracts>();

  // Create a FTSO for WNAT
  let ftsoWnat: FtsoInstance;
  if (parameters.deployNATFtso) {
    ftsoWnat = await Ftso.new(parameters.nativeSymbol, parameters.nativeFtsoDecimals, priceSubmitterAddress, wNatAddress, ftsoManager.address, ftsoStartTs, parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
    spewNewContractInfo(contracts, null, `FTSO WNAT`, `Ftso.sol`, ftsoWnat.address, quiet);

    assetToContracts.set(parameters.nativeSymbol, {
      ftso: ftsoWnat,
      assetSymbol: parameters.nativeSymbol
    })
  }
  // Deploy asset, minter, and initial FTSOs 

  for (let asset of parameters.assets) {
    if (!quiet) {
      console.error(`Rigging ${asset.assetSymbol}...`);
    }

    let xAssetDefinition = rewrapXassetParams(asset);
    // Register an FTSO for the new Asset
    const ftso = await Ftso.new(xAssetDefinition.symbol, xAssetDefinition.ftsoDecimals, priceSubmitterAddress, wNatAddress, ftsoManager.address, ftsoStartTs, parameters.priceEpochDurationSeconds,
    parameters.revealEpochDurationSeconds, xAssetDefinition.initialPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
    spewNewContractInfo(contracts, null, `FTSO ${xAssetDefinition.symbol}`, `Ftso.sol`, ftso.address, quiet);

    assetToContracts.set(asset.assetSymbol, {
      assetSymbol: asset.assetSymbol,
      ftso: ftso
    });
  }

  await pollingFoundation.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.SUPPLY]),
    [addressUpdaterAddress, ftsoManager.address, governanceVotePowerAddress, supplyAddress]);

  await claimSetupManager.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.WNAT]),
    [addressUpdaterAddress, ftsoManager.address, wNatAddress]);

  await ftsoRewardManager.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER]),
    [addressUpdaterAddress, inflationAddress, ftsoManager.address, wNatAddress, claimSetupManager.address]);

  await ftsoManager.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
    [addressUpdaterAddress, ftsoRewardManager.address, ftsoRegistry.address, voterWhitelisterAddress, supplyAddress, cleanupBlockNumberManagerAddress]);

  await ftsoRegistry.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
    [addressUpdaterAddress, ftsoManager.address]);

  await validatorRewardManager.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.WNAT]),
    [addressUpdaterAddress, inflationAddress, wNatAddress]);

  // Setup governance parameters for the ftso manager
  if (!quiet) {
    console.error("Setting FTSO manager governance parameters...");
  }
  await ftsoManager.setGovernanceParameters(
    parameters.maxVotePowerNatThresholdFraction,
    parameters.maxVotePowerAssetThresholdFraction,
    parameters.lowAssetThresholdUSDDec5,
    parameters.highAssetThresholdUSDDec5,
    parameters.highAssetTurnoutThresholdBIPS,
    parameters.lowNatTurnoutThresholdBIPS,
    Math.floor(parameters.ftsoRewardExpiryOffsetDays * 60 * 60 * 24),
    parameters.trustedAddresses);

  if (!quiet) {
    console.error("Setting validator reward distributor...");
  }
  await validatorRewardManager.setRewardDistributor(parameters.governancePublicKey);

  if (!quiet) {
    console.error("Activating validator reward manager...");
  }
  await validatorRewardManager.activate();

  if (!quiet) {
    console.error("Switching to production mode...");
  }

  await flareAssetRegistry.switchToProductionMode();
  await ftsoRegistry.switchToProductionMode();
  await validatorRewardManager.switchToProductionMode();
  await claimSetupManager.switchToProductionMode();
  await pollingFoundation.switchToProductionMode();

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  return {
    ftsoRewardManager: ftsoRewardManager,
    ftsoManager: ftsoManager,
    ftsoRegistry: ftsoRegistry,
    ftsoContracts: [
      ...(parameters.deployNATFtso ? [{ xAssetSymbol: 'WNAT' }] : []),
      ...parameters.assets
    ].map(asset => assetToContracts.get(asset.xAssetSymbol)),
    contracts: contracts,
  } as DeployedFlareContracts;
}
 