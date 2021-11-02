/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AddressUpdaterContract, CleanupBlockNumberManagerContract, DataAvailabilityRewardManagerContract, DistributionContract, FlareDaemonContract, FtsoContract, FtsoManagerContract, FtsoRegistryContract, FtsoRewardManagerContract, FtsoV2SwitcherContract, IIFtsoManagerV1Contract, InflationAllocationContract, InflationContract, PriceSubmitterContract, StateConnectorContract, SupplyContract, VoterWhitelisterContract, WNatContract } from '../../typechain-truffle';
import { Contracts } from "./Contracts";
import { AssetContracts, DeployedFlareContracts, deployNewAsset, rewrapXassetParams, spewNewContractInfo, verifyParameters } from './deploy-utils';


export async function deployFtsoV2(hre: HardhatRuntimeEnvironment, oldContracts: Contracts, parameters: any, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;

  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
  // Define address updater contracts names list
  const addressUpdaterContracts: string[] = [];
  // Define accounts in play for the deployment process
  let deployerAccount: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private key is correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const AddressUpdater: AddressUpdaterContract = artifacts.require("AddressUpdater");
  const InflationAllocation: InflationAllocationContract = artifacts.require("InflationAllocation");
  const StateConnector: StateConnectorContract = artifacts.require("StateConnector");
  const FlareDaemon: FlareDaemonContract = artifacts.require("FlareDaemon");
  // const TestableFlareDaemon: TestableFlareDaemonContract = artifacts.require("TestableFlareDaemon");
  const Ftso: FtsoContract = artifacts.require("Ftso");
  const FtsoManager: FtsoManagerContract = artifacts.require("FtsoManager");
  const Inflation: InflationContract = artifacts.require("Inflation");
  const FtsoRegistry: FtsoRegistryContract = artifacts.require("FtsoRegistry");
  const FtsoRewardManager: FtsoRewardManagerContract = artifacts.require("FtsoRewardManager");
  const DataAvailabilityRewardManager: DataAvailabilityRewardManagerContract = artifacts.require("DataAvailabilityRewardManager");
  const CleanupBlockNumberManager: CleanupBlockNumberManagerContract = artifacts.require("CleanupBlockNumberManager");
  const PriceSubmitter: PriceSubmitterContract = artifacts.require("PriceSubmitter");
  const Supply: SupplyContract = artifacts.require("Supply");
  const VoterWhitelister: VoterWhitelisterContract = artifacts.require("VoterWhitelister");
  const WNat: WNatContract = artifacts.require("WNat");
  const Distribution: DistributionContract = artifacts.require("Distribution");
  const FtsoV2Switcher: FtsoV2SwitcherContract = artifacts.require("FtsoV2Switcher");

  // import old ftso manager interface
  const OldFtsoManager: IIFtsoManagerV1Contract = artifacts.require("IIFtsoManagerV1");

  const flareDaemon = await FlareDaemon.at(oldContracts.getContractAddress(Contracts.FLARE_DAEMON));
  spewNewContractInfo(contracts, addressUpdaterContracts, FlareDaemon.contractName, `FlareDaemon.sol`, flareDaemon.address, quiet);
  const stateConnector = await StateConnector.at(oldContracts.getContractAddress(Contracts.STATE_CONNECTOR));
  spewNewContractInfo(contracts, addressUpdaterContracts, StateConnector.contractName, `StateConnector.sol`, stateConnector.address, quiet);
  const priceSubmitter = await PriceSubmitter.at(oldContracts.getContractAddress(Contracts.PRICE_SUBMITTER));
  spewNewContractInfo(contracts, addressUpdaterContracts, PriceSubmitter.contractName, `PriceSubmitter.sol`, priceSubmitter.address, quiet);
  const wNat = await WNat.at(oldContracts.getContractAddress(Contracts.WNAT));
  spewNewContractInfo(contracts, addressUpdaterContracts, WNat.contractName, `WNat.sol`, wNat.address, quiet);
  const ftsoRewardManager = await FtsoRewardManager.at(oldContracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRewardManager.contractName, `FtsoRewardManager.sol`, ftsoRewardManager.address, quiet);
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.at(oldContracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
  spewNewContractInfo(contracts, addressUpdaterContracts, CleanupBlockNumberManager.contractName, `CleanupBlockNumberManager.sol`, cleanupBlockNumberManager.address, quiet);
  const ftsoRegistry = await FtsoRegistry.at(oldContracts.getContractAddress(Contracts.FTSO_REGISTRY));
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRegistry.contractName, `FtsoRegistry.sol`, ftsoRegistry.address, quiet);
  const voterWhitelister = await VoterWhitelister.at(oldContracts.getContractAddress(Contracts.VOTER_WHITELISTER));
  spewNewContractInfo(contracts, addressUpdaterContracts, VoterWhitelister.contractName, `VoterWhitelister.sol`, voterWhitelister.address, quiet);
  const supply = await Supply.at(oldContracts.getContractAddress(Contracts.SUPPLY));
  spewNewContractInfo(contracts, addressUpdaterContracts, Supply.contractName, `Supply.sol`, supply.address, quiet);
  const inflationAllocation = await InflationAllocation.at(oldContracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
  spewNewContractInfo(contracts, addressUpdaterContracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);
  const inflation = await Inflation.at(oldContracts.getContractAddress(Contracts.INFLATION));
  spewNewContractInfo(contracts, addressUpdaterContracts, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);

  if (parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0) {
    const dataAvailabilityRewardManager = await DataAvailabilityRewardManager.at(oldContracts.getContractAddress(Contracts.DATA_AVAILABILITY_REWARD_MANAGER));
    spewNewContractInfo(contracts, addressUpdaterContracts, DataAvailabilityRewardManager.contractName, `DataAvailabilityRewardManager.sol`, dataAvailabilityRewardManager.address, quiet);
  }

  if (parameters.deployDistributionContract) {
    const distribution = await Distribution.at(oldContracts.getContractAddress(Contracts.DISTRIBUTION));
    spewNewContractInfo(contracts, addressUpdaterContracts, Distribution.contractName, `Distribution.sol`, distribution.address, quiet);
  }

  const oldFtsoManager = await OldFtsoManager.at(oldContracts.getContractAddress(Contracts.FTSO_MANAGER));

  // AddressUpdater
  const addressUpdater = await AddressUpdater.new(deployerAccount.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, AddressUpdater.contractName, `AddressUpdater.sol`, addressUpdater.address, quiet);

  const priceEpochConfiguration = await oldFtsoManager.getPriceEpochConfiguration();
  const startTs = priceEpochConfiguration[0];
  const priceEpochDurationSeconds = priceEpochConfiguration[1];
  const revealEpochDurationSeconds = priceEpochConfiguration[2];

  // Delayed reward epoch start time
  const rewardEpochStartTs = await oldFtsoManager.rewardEpochsStartTs();
  const rewardEpochDurationSeconds = await oldFtsoManager.rewardEpochDurationSeconds();

  // FtsoManager contract
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareDaemon.address,
    addressUpdater.address,
    priceSubmitter.address,
    oldFtsoManager.address,
    startTs,
    priceEpochDurationSeconds,
    revealEpochDurationSeconds,
    rewardEpochStartTs,
    rewardEpochDurationSeconds,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  // FtsoV2Switcher contract
  const ftsoV2Switcher = await FtsoV2Switcher.new(deployerAccount.address, addressUpdater.address);
  spewNewContractInfo(contracts, null, FtsoV2Switcher.contractName, `FtsoV2Switcher.sol`, ftsoV2Switcher.address, quiet);

  let assetToContracts = new Map<string, AssetContracts>();
  
  // Create a FTSO for WNAT
  let ftsoWnat: any;
  if (parameters.deployNATFtso) {
    ftsoWnat = await Ftso.new(parameters.nativeSymbol, parameters.nativeFtsoDecimals, priceSubmitter.address, wNat.address, ftsoManager.address, startTs, priceEpochDurationSeconds,
      revealEpochDurationSeconds, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize, parameters.minimalFtsoRandom);
    spewNewContractInfo(contracts, null, `FTSO ${parameters.wrappedNativeSymbol}`, `Ftso.sol`, ftsoWnat.address, quiet);

    assetToContracts.set(parameters.nativeSymbol, {
      xAssetToken: wNat,
      ftso: ftsoWnat,
      assetSymbol: parameters.nativeSymbol
    })
  }
  // Deploy asset, minter, and initial FTSOs 

  for (let asset of parameters.assets) {
    if (!quiet) {
      console.error(`Rigging ${asset.assetSymbol}...${parameters.deployDummyXAssetTokensAndMinters ? " with dummy token and minter" : ""}`);
    }

    let assetContracts = await deployNewAsset(
      hre,
      contracts,
      deployerAccount.address,
      ftsoManager,
      priceSubmitter.address,
      wNat.address,
      cleanupBlockNumberManager,
      startTs, 
      parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds,
      rewrapXassetParams(asset),
      parameters.priceDeviationThresholdBIPS,
      parameters.priceEpochCyclicBufferSize,
      parameters.minimalFtsoRandom,
      parameters.deployDummyXAssetTokensAndMinters,
      quiet,
    );
    assetToContracts.set(asset.assetSymbol, {
      assetSymbol: asset.assetSymbol,
      ...assetContracts
    });
  }

  // copy reward data
  if (!quiet) {
    console.error("Setting FTSO manager reward data...");
  }

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

  if (parameters.deployNATFtso) {
    // Set FTSOs to multi Asset WNAT contract
    let multiAssets = parameters.NATMultiAssets;
    let multiAssetFtsos = multiAssets.map((asset: any) => assetToContracts.get(asset)!.ftso!.address)
    await ftsoManager.setFtsoAssetFtsos(ftsoWnat.address, multiAssetFtsos);
  }

  if (!quiet) {
    console.error("Adding contract names and addresses to address updater and setting them on ftso manager...");
  }

  // Tell address updater about all contracts
  await addressUpdater.addOrUpdateContractNamesAndAddresses(
    addressUpdaterContracts, addressUpdaterContracts.map( name => contracts.getContractAddress(name) )
  );

  // Set contracts on ftso manager
  await addressUpdater.updateContractAddresses([ftsoManager.address]);

  let assetList = [
    ...(parameters.deployNATFtso ? [{ assetSymbol: parameters.nativeSymbol}] : []), 
    ...parameters.assets
  ]
  let ftsoAddresses: string[] = [];
  for (let asset of assetList) {
    let ftsoContract = (assetToContracts.get(asset.assetSymbol) as AssetContracts).ftso;
    ftsoAddresses.push(ftsoContract.address);
  }

  if (!quiet) {
    console.error("Setting ftso V2 switcher data...");
  }
  await ftsoV2Switcher.setFtsosToReplace(ftsoAddresses);

  // Register daemonized contracts to the daemon...order matters. Inflation first.
  if (!quiet) {
    console.error(`Setting registration: Inflation with gas limit ${parameters.inflationGasLimit}`);
    console.error(`Setting registration: FtsoManager with gas limit ${parameters.ftsoManagerGasLimit}`);
  }
  const registrations = [
    { daemonizedContract: inflation.address, gasLimit: parameters.inflationGasLimit },
    { daemonizedContract: ftsoManager.address, gasLimit: parameters.ftsoManagerGasLimit }
  ];
  await ftsoV2Switcher.setFlareDaemonRegistrations(registrations);

  if (!quiet) {
    console.error("Transferring ftso manager governance to ftso V2 switcher contract...");
  }
  await ftsoManager.transferGovernance(ftsoV2Switcher.address);

  if (!quiet) {
    console.error(`Transferring governance to multisig governance ${parameters.governancePublicKey}`);
  }
  await addressUpdater.transferGovernance(parameters.governancePublicKey);
  await ftsoV2Switcher.transferGovernance(parameters.governancePublicKey);

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  return {
    ftsoManager: ftsoManager,
    ftsoContracts: [
      ...(parameters.deployNATFtso ? [{ xAssetSymbol: 'WNAT' }] : []),
      ...parameters.assets
    ].map(asset => assetToContracts.get(asset.xAssetSymbol))
  } as DeployedFlareContracts;
}
  