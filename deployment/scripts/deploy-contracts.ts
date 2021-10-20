/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AddressUpdaterContract, CleanupBlockNumberManagerContract, DataAvailabilityRewardManagerContract, DataAvailabilityRewardManagerInstance, DistributionContract, FlareDaemonContract, FlareDaemonInstance, FtsoContract, FtsoInstance, FtsoManagerContract, FtsoRegistryContract, FtsoRewardManagerContract, InflationAllocationContract, InflationContract, PriceSubmitterContract, PriceSubmitterInstance, StateConnectorContract, StateConnectorInstance, SupplyContract, TestableFlareDaemonContract, VoterWhitelisterContract, WNatContract } from '../../typechain-truffle';
import { Contracts } from "./Contracts";
import { AssetContracts, DeployedFlareContracts, deployNewAsset, rewrapXassetParams, setDefaultVPContract, spewNewContractInfo, verifyParameters, waitFinalize3 } from './deploy-utils';


export async function deployContracts(hre: HardhatRuntimeEnvironment, parameters: any, quiet: boolean = false) {
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
  let genesisGovernanceAccount: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
    genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.genesisGovernancePrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Check whether genesis governance account has some funds. If not, wire 1 NAT 
  let genesisGovernanceBalance = await web3.eth.getBalance(genesisGovernanceAccount.address);
  if(genesisGovernanceBalance == '0') {
    console.error("Sending 2 NAT to genesis governance account ...");
    await waitFinalize3(hre, deployerAccount.address, () => web3.eth.sendTransaction({from: deployerAccount.address, to: genesisGovernanceAccount.address, value: web3.utils.toWei("2") }));
  }
  genesisGovernanceBalance = await web3.eth.getBalance(genesisGovernanceAccount.address);
  if(genesisGovernanceBalance == '0') {
    throw Error("Genesis governance account still empty.")
  }
  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const AddressUpdater: AddressUpdaterContract = artifacts.require("AddressUpdater");
  const InflationAllocation: InflationAllocationContract = artifacts.require("InflationAllocation");
  const StateConnector: StateConnectorContract = artifacts.require("StateConnector");
  const FlareDaemon: FlareDaemonContract = artifacts.require("FlareDaemon");
  const TestableFlareDaemon: TestableFlareDaemonContract = artifacts.require("TestableFlareDaemon");
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

  let deployDataAvailabilityRewardManager = parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0;

  // Initialize the state connector
  let stateConnector: StateConnectorInstance;
  try {
    stateConnector = await StateConnector.at(parameters.stateConnectorAddress);
  } catch (e) {
    if (!quiet) {
      console.error("StateConnector not in genesis...creating new.")
    }
    stateConnector = await StateConnector.new();
  }
  spewNewContractInfo(contracts, addressUpdaterContracts, StateConnector.contractName, `StateConnector.sol`, stateConnector.address, quiet);

  try {
    await stateConnector.initialiseChains();
  } catch (e) {
    // state connector might be already initialized if redeploy
    console.error(`stateConnector.initializeChains() failed. Ignore if redeploy. Error = ${e}`);
  }

  // Initialize the daemon
  let flareDaemon: FlareDaemonInstance;
  try {
    flareDaemon = await FlareDaemon.at(parameters.flareDaemonAddress);
  } catch (e) {
    if (!quiet) {
      console.error("FlareDaemon not in genesis...creating new.")
    }
    // If the flare daemon is not in the genesis block, it will never be triggered automatically.
    // Therefore we need TestableFlareDaemon which can be triggered from outside.
    // WARNING: This should only happen in test.
    flareDaemon = await TestableFlareDaemon.new();
  }
  spewNewContractInfo(contracts, addressUpdaterContracts, FlareDaemon.contractName, `FlareDaemon.sol`, flareDaemon.address, quiet);

  try {
    await flareDaemon.initialiseFixedAddress();
  } catch (e) {
    console.error(`flareDaemon.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  let currentGovernanceAddress = await flareDaemon.governance()

  // Unregister whatever is registered with verification
  try {
    console.error("Unregistring contracts");
    try {
      await waitFinalize3(hre, currentGovernanceAddress, () => flareDaemon.registerToDaemonize([], { from: currentGovernanceAddress }));
    } catch (ee) {
      console.error("Error while unregistring. ", ee)
    }
  } catch (e) {
    console.error("No more kept contracts")
  }

  await flareDaemon.proposeGovernance(deployerAccount.address, { from: currentGovernanceAddress });
  await flareDaemon.claimGovernance({ from: deployerAccount.address });
  // Set the block holdoff should a kept contract exceeded its max gas allocation
  await flareDaemon.setBlockHoldoff(parameters.flareDaemonGasExceededHoldoffBlocks);

  // PriceSubmitter contract
  let priceSubmitter: PriceSubmitterInstance;
  try {
    priceSubmitter = await PriceSubmitter.at(parameters.priceSubmitterAddress);
  } catch (e) {
    if (!quiet) {
      console.error("PriceSubmitter not in genesis...creating new.")
    }
    priceSubmitter = await PriceSubmitter.new();
  }
  // This has to be done always
  try {
    await priceSubmitter.initialiseFixedAddress();
  } catch (e) {
    console.error(`priceSubmitter.initializeChains() failed. Ignore if redeploy. Error = ${e}`);
  }

  // Assigning governance to deployer
  let priceSubmitterGovernance = await priceSubmitter.governance();
  await priceSubmitter.proposeGovernance(deployerAccount.address, { from: priceSubmitterGovernance });
  await priceSubmitter.claimGovernance({ from: deployerAccount.address })

  spewNewContractInfo(contracts, addressUpdaterContracts, PriceSubmitter.contractName, "PriceSubmitter.sol", priceSubmitter.address, quiet);

  // AddressUpdater
  const addressUpdater = await AddressUpdater.new(deployerAccount.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, AddressUpdater.contractName, `AddressUpdater.sol`, addressUpdater.address, quiet);

  // InflationAllocation contract
  // Inflation will be set to 0 for now...it will be set shortly.
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, "0x0000000000000000000000000000000000000000", parameters.scheduledInflationPercentageBIPS);
  spewNewContractInfo(contracts, addressUpdaterContracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);

  // Get the timestamp for the just mined block
  let currentBlock = await web3.eth.getBlock(await web3.eth.getBlockNumber());
  const startTs = BN(currentBlock.timestamp);

  // Delayed reward epoch start time
  const rewardEpochStartTs = startTs.addn(parameters.rewardEpochsStartDelayPriceEpochs * parameters.priceEpochDurationSeconds + parameters.revealEpochDurationSeconds);

  // Inflation contract
  const inflation = await Inflation.new(
    deployerAccount.address,
    flareDaemon.address,
    inflationAllocation.address,
    inflationAllocation.address,
    startTs
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);

  // The daemon needs a reference to the inflation contract.
  await flareDaemon.setInflation(inflation.address);
  // InflationAllocation needs a reference to the inflation contract.
  await inflationAllocation.setInflation(inflation.address);

  // Supply contract
  const supply = await Supply.new(
    deployerAccount.address,
    parameters.burnAddress,
    inflation.address,
    BN(parameters.totalNativeSupplyNAT).mul(BN(10).pow(BN(18))),
    BN(parameters.totalFoundationSupplyNAT).mul(BN(10).pow(BN(18))),
    []
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, Supply.contractName, `Supply.sol`, supply.address, quiet);

  // FtsoRewardManager contract
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    parameters.rewardFeePercentageUpdateOffsetEpochs,
    parameters.defaultRewardFeePercentageBIPS);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRewardManager.contractName, `FtsoRewardManager.sol`, ftsoRewardManager.address, quiet);

  // DataAvailabilityRewardManager contract
  let dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance | null = null;

  if (deployDataAvailabilityRewardManager) {
    dataAvailabilityRewardManager = await DataAvailabilityRewardManager.new(
      deployerAccount.address,
      parameters.dataAvailabilityRewardExpiryOffsetEpochs,
      stateConnector.address,
      inflation.address);
    spewNewContractInfo(contracts, addressUpdaterContracts, DataAvailabilityRewardManager.contractName, `DataAvailabilityRewardManager.sol`, dataAvailabilityRewardManager.address, quiet);
  }

  // CleanupBlockNumberManager contract
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.new(
    deployerAccount.address,
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, CleanupBlockNumberManager.contractName, `CleanupBlockNumberManager.sol`, cleanupBlockNumberManager.address, quiet);

  // Inflation allocation needs to know about reward managers
  // await inflationAllocation.setSharingPercentages([ftsoRewardManager.address, dataAvailabilityRewardManager.address], [8000, 2000]);
  let receiversAddresses = []
  for (let a of parameters.inflationReceivers) {
    receiversAddresses.push(contracts.getContractAddress(a));
  }
  await inflationAllocation.setSharingPercentages(receiversAddresses, parameters.inflationSharingBIPS);

  // Supply contract needs to know about reward managers
  await supply.addTokenPool(ftsoRewardManager.address, 0);
  if (deployDataAvailabilityRewardManager) {
    await supply.addTokenPool(dataAvailabilityRewardManager!.address, 0);
  }

  // setup topup factors on inflation receivers
  for (let i = 0; i < receiversAddresses.length; i++) {
    await inflation.setTopupConfiguration(receiversAddresses[i], parameters.inflationTopUpTypes[i], parameters.inflationTopUpFactorsx100[i])
  }

  // The inflation needs a reference to the supply contract.
  await inflation.setSupply(supply.address);

  // FtsoRegistryContract
  const ftsoRegistry = await FtsoRegistry.new(deployerAccount.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRegistry.contractName, `FtsoRegistry.sol`, ftsoRegistry.address, quiet);

  // VoterWhitelisting
  const voterWhitelister = await VoterWhitelister.new(deployerAccount.address, priceSubmitter.address, parameters.defaultVoterWhitelistSize);
  spewNewContractInfo(contracts, addressUpdaterContracts, VoterWhitelister.contractName, `VoterWhitelister.sol`, voterWhitelister.address, quiet);

  // Distribution Contract
  if (parameters.deployDistributionContract) {
    const distribution = await Distribution.new(deployerAccount.address);
    spewNewContractInfo(contracts, addressUpdaterContracts, Distribution.contractName, `Distribution.sol`, distribution.address, quiet);
  }

  // FtsoManager contract
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareDaemon.address,
    addressUpdater.address,
    priceSubmitter.address,
    "0x0000000000000000000000000000000000000000", // old ftso manager
    startTs,
    parameters.priceEpochDurationSeconds,
    parameters.revealEpochDurationSeconds,
    rewardEpochStartTs,
    parameters.rewardEpochDurationSeconds,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address);
  await cleanupBlockNumberManager.setTriggerContractAddress(ftsoManager.address);

  await voterWhitelister.setContractAddresses(ftsoRegistry.address, ftsoManager.address);
  await priceSubmitter.setContractAddresses(ftsoRegistry.address, voterWhitelister.address, ftsoManager.address);

  // Deploy wrapped native token
  const wNat = await WNat.new(deployerAccount.address, parameters.wrappedNativeName, parameters.wrappedNativeSymbol);
  spewNewContractInfo(contracts, addressUpdaterContracts, WNat.contractName, `WNat.sol`, wNat.address, quiet);

  await setDefaultVPContract(hre, wNat, deployerAccount.address);
  await cleanupBlockNumberManager.registerToken(wNat.address);
  await wNat.setCleanupBlockNumberManager(cleanupBlockNumberManager.address)

  // Tell reward manager about contracts
  await ftsoRewardManager.setContractAddresses(inflation.address, ftsoManager.address, wNat.address);

  // Tell address updater about all contracts
  await addressUpdater.addOrUpdateContractNamesAndAddresses(
    addressUpdaterContracts, addressUpdaterContracts.map( name => contracts.getContractAddress(name) )
  );

  // Set contracts on ftso manager
  await addressUpdater.updateContractAddresses([ftsoManager.address]);

  let assetToContracts = new Map<string, AssetContracts>();

  // Create a FTSO for WNAT
  let ftsoWnat: FtsoInstance;
  if (parameters.deployNATFtso) {
    ftsoWnat = await Ftso.new(parameters.nativeSymbol, parameters.nativeFtsoDecimals, priceSubmitter.address, wNat.address, ftsoManager.address, startTs, parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
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
      parameters.deployDummyXAssetTokensAndMinters,
      quiet,
    );
    assetToContracts.set(asset.assetSymbol, {
      assetSymbol: asset.assetSymbol,
      ...assetContracts
    });
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

  // Add ftsos to the ftso manager
  if (!quiet) {
    console.error("Adding FTSOs to manager...");
  }

  let assetList = [
    ...(parameters.deployNATFtso ? [{ assetSymbol: parameters.nativeSymbol}] : []), 
    ...parameters.assets
  ]

  for (let asset of assetList) {
    let ftsoContract = (assetToContracts.get(asset.assetSymbol) as AssetContracts).ftso;
    await waitFinalize3(hre, deployerAccount.address, () => ftsoManager.addFtso(ftsoContract.address));
  }

  if (parameters.deployNATFtso) {
    // Set FTSOs to multi Asset WNAT contract
    let multiAssets = parameters.NATMultiAssets;
    let multiAssetFtsos = multiAssets.map((asset: any) => assetToContracts.get(asset)!.ftso!.address)
    await ftsoManager.setFtsoAssetFtsos(ftsoWnat!.address, multiAssetFtsos);
  }

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  return {
    cleanupBlockNumberManager: cleanupBlockNumberManager,
    ftsoRewardManager: ftsoRewardManager,
    ftsoManager: ftsoManager,
    flareDaemon: flareDaemon,
    priceSubmitter: priceSubmitter,
    dataAvailabilityRewardManager: dataAvailabilityRewardManager,
    supply: supply,
    inflationAllocation: inflationAllocation,
    stateConnector: stateConnector,
    ftsoRegistry: ftsoRegistry,
    ftsoContracts: [
      ...(parameters.deployNATFtso ? [{ xAssetSymbol: 'WNAT' }] : []),
      ...parameters.assets
    ].map(asset => assetToContracts.get(asset.xAssetSymbol))
  } as DeployedFlareContracts;
}
