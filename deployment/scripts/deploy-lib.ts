/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { pascalCase } from "pascal-case";
import { setDefaultVPContract } from "../../test/utils/token-test-helpers";
import {
  CleanupBlockNumberManagerInstance,
  DummyAssetMinterInstance,
  AssetTokenInstance,
  FlareDaemonInstance,
  FtsoInstance,
  FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerInstance, InflationAllocationInstance, PriceSubmitterInstance,
  StateConnectorInstance,
  SupplyInstance,
  DataAvailabilityRewardManagerInstance,
  WNatInstance
} from "../../typechain-truffle";
import { Contract, Contracts } from "./Contracts";

export interface AssetDefinition {
  name: string;
  symbol: string;
  decimals: number;
  maxMintRequestTwei: number;
  initialPriceUSD5Dec: number;
}

export interface AssetContracts {
  xAssetToken: AssetTokenInstance | WNatInstance;
  ftso: FtsoInstance;
  dummyAssetMinter?: DummyAssetMinterInstance;
  definition?: AssetDefinition;
  assetSymbol: string;
}

export interface DeployedFlareContracts {
  cleanupBlockNumberManager: CleanupBlockNumberManagerInstance,
  ftsoRewardManager: FtsoRewardManagerInstance,
  ftsoManager: FtsoManagerInstance,
  flareDaemon: FlareDaemonInstance,
  priceSubmitter: PriceSubmitterInstance,
  dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance,
  supply: SupplyInstance,
  inflationAllocation: InflationAllocationInstance,
  stateConnector: StateConnectorInstance,
  ftsoRegistry: FtsoRegistryInstance,
  ftsoContracts: AssetContracts[]
}

export function ftsoContractForSymbol(contracts: DeployedFlareContracts, symbol: string) {
  return contracts.ftsoContracts.find(x => x.assetSymbol === symbol)
}
// import { serializedParameters } from "./DeploymentParameters";

const BN = web3.utils.toBN;
import { constants, time } from '@openzeppelin/test-helpers';
import { waitFinalize3 } from "../../test/utils/test-helpers";
import { TestableFlareDaemonInstance } from "../../typechain-truffle/TestableFlareDaemon";

export async function fullDeploy(parameters: any, quiet = false) {
  // Define repository for created contracts
  const contracts = new Contracts();

  // Define accounts in play for the deployment process
  let deployerAccount: any;
  let governanceAccount: any;
  let genesisGovernanceAccount

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
    governanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);
    genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.genesisGovernancePrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const InflationAllocation = artifacts.require("InflationAllocation");
  const StateConnector = artifacts.require("StateConnector");
  const FlareDaemon = artifacts.require("FlareDaemon");
  const TestableFlareDaemon = artifacts.require("TestableFlareDaemon");
  const Ftso = artifacts.require("Ftso");
  const FtsoManager = artifacts.require("FtsoManager");
  const Inflation = artifacts.require("Inflation");
  const FtsoRegistry = artifacts.require("FtsoRegistry");
  const FtsoRewardManager = artifacts.require("FtsoRewardManager");
  const DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");
  const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
  const PriceSubmitter = artifacts.require("PriceSubmitter");
  const Supply = artifacts.require("Supply");
  const VoterWhitelister = artifacts.require("VoterWhitelister");
  const WNAT = artifacts.require("WNat");
  const Distribution = artifacts.require("Distribution");

  // InflationAllocation contract
  // Inflation will be set to 0 for now...it will be set shortly.
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, constants.ZERO_ADDRESS, parameters.inflationPercentageBIPS);
  spewNewContractInfo(contracts, InflationAllocation.contractName, inflationAllocation.address, quiet);

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
  spewNewContractInfo(contracts, StateConnector.contractName, stateConnector.address, quiet);

  try {
    await stateConnector.initialiseChains();
  } catch (e) {
    // state connector might be already initialized if redeploy
    console.error(`stateConnector.initializeChains() failed. Ignore if redeploy. Error = ${e}`);
  }

  // Initialize the daemon
  let flareDaemon: FlareDaemonInstance | TestableFlareDaemonInstance;
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

  spewNewContractInfo(contracts, FlareDaemon.contractName, flareDaemon.address, quiet);

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
      await waitFinalize3(currentGovernanceAddress, () => flareDaemon.registerToDaemonize([], { from: currentGovernanceAddress }));
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

  // Checking if governance is OK, especially when redeploying.
  let priceSubmitterGovernance = await priceSubmitter.governance();
  if (currentGovernanceAddress != priceSubmitterGovernance) {
    console.error("Current governance does not match price submitter governance");
    console.error("Current governance:", currentGovernanceAddress);
    console.error("Price submitter goveranance:", priceSubmitterGovernance);
    await priceSubmitter.proposeGovernance(currentGovernanceAddress, { from: priceSubmitterGovernance });
    await priceSubmitter.claimGovernance({ from: currentGovernanceAddress })
    let newPriceSubmitterGovernance = await priceSubmitter.governance();
    if (currentGovernanceAddress == newPriceSubmitterGovernance) {
      console.error("Governance of PriceSubmitter changed")
    } else {
      console.error("Governance for PriceSubmitter does not match. Bailing out ...")
      process.exit(1)
    }
  }
  spewNewContractInfo(contracts, PriceSubmitter.contractName, priceSubmitter.address, quiet);

  // Get the timestamp for the just mined block
  const startTs = await time.latest();

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
  spewNewContractInfo(contracts, Inflation.contractName, inflation.address, quiet);
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
  spewNewContractInfo(contracts, Supply.contractName, supply.address, quiet);

  // FtsoRewardManager contract
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    parameters.rewardFeePercentageUpdateOffsetEpochs,
    parameters.defaultRewardFeePercentageBIPS,
    inflation.address);
  spewNewContractInfo(contracts, FtsoRewardManager.contractName, ftsoRewardManager.address, quiet);

  // DataAvailabilityRewardManager contract
  const dataAvailabilityRewardManager = await DataAvailabilityRewardManager.new(
    deployerAccount.address,
    parameters.dataAvailabilityRewardExpiryOffsetEpochs,
    stateConnector.address,
    inflation.address);
  spewNewContractInfo(contracts, DataAvailabilityRewardManager.contractName, dataAvailabilityRewardManager.address, quiet);

  // CleanupBlockNumberManager contract
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.new(
    deployerAccount.address,
  );
  spewNewContractInfo(contracts, CleanupBlockNumberManager.contractName, cleanupBlockNumberManager.address, quiet);


  // Inflation allocation needs to know about reward managers
  // await inflationAllocation.setSharingPercentages([ftsoRewardManager.address, validatorRewardManager.address], [8000, 2000]);
  await inflationAllocation.setSharingPercentages(
    [ftsoRewardManager.address, dataAvailabilityRewardManager.address],
    [parameters.ftsoRewardManagerSharingPercentageBIPS, parameters.dataAvailabilityRewardManagerSharingPercentageBIPS]
  );
  // Supply contract needs to know about reward managers
  await supply.addTokenPool(ftsoRewardManager.address, 0);
  await supply.addTokenPool(dataAvailabilityRewardManager.address, 0);

  // The inflation needs a reference to the supply contract.
  await inflation.setSupply(supply.address);

  // FtsoRegistryContract
  const ftsoRegistry = await FtsoRegistry.new(deployerAccount.address);
  spewNewContractInfo(contracts, FtsoRegistry.contractName, ftsoRegistry.address, quiet);

  // VoterWhitelisting
  const voterWhitelister = await VoterWhitelister.new(currentGovernanceAddress, priceSubmitter.address, parameters.defaultVoterWhitelistSize);
  spewNewContractInfo(contracts, VoterWhitelister.contractName, voterWhitelister.address, quiet);

  // Distribution Contract
  const distribution = await Distribution.new();
  spewNewContractInfo(contracts, Distribution.contractName, distribution.address, quiet);

  // FtsoManager contract
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareDaemon.address,
    ftsoRewardManager.address,
    priceSubmitter.address,
    ftsoRegistry.address,
    voterWhitelister.address,
    parameters.priceEpochDurationSeconds,
    startTs,
    parameters.revealEpochDurationSeconds,
    parameters.rewardEpochDurationSeconds,
    rewardEpochStartTs,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, FtsoManager.contractName, ftsoManager.address, quiet);

  await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address);
  await ftsoManager.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);
  await cleanupBlockNumberManager.setTriggerContractAddress(ftsoManager.address);

  await voterWhitelister.setContractAddresses(ftsoRegistry.address, ftsoManager.address, { from: currentGovernanceAddress });
  await priceSubmitter.setContractAddresses(ftsoRegistry.address, voterWhitelister.address, ftsoManager.address, { from: currentGovernanceAddress });

  // Tell reward manager about ftso manager
  await ftsoRewardManager.setFTSOManager(ftsoManager.address);

  // Register daemonized contracts to the daemon...order matters. Inflation first.
  const registrations = [
    { daemonizedContract: inflation.address, gasLimit: 10000000 },
    { daemonizedContract: ftsoManager.address, gasLimit: 10000000 }
  ];
  await flareDaemon.registerToDaemonize(registrations);

  // Deploy wrapped native token
  const wnat = await WNAT.new(deployerAccount.address);
  spewNewContractInfo(contracts, WNAT.contractName, wnat.address, quiet);

  await setDefaultVPContract(wnat, deployerAccount.address);
  await cleanupBlockNumberManager.registerToken(wnat.address);
  await wnat.setCleanupBlockNumberManager(cleanupBlockNumberManager.address)


  await ftsoRewardManager.setWNAT(wnat.address);

  // Create a non-asset FTSO
  // Register an FTSO for WNAT
  const ftsoWnat = await Ftso.new("WNAT", wnat.address, ftsoManager.address, supply.address, parameters.initialWnatPriceUSD5Dec, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
  spewNewContractInfo(contracts, `FTSO WNAT`, ftsoWnat.address, quiet);

  let assetToContracts = new Map<string, AssetContracts>();
  assetToContracts.set("NAT", {
    xAssetToken: wnat,
    ftso: ftsoWnat,
    assetSymbol: 'NAT'
  })

  // Deploy asset, minter, and initial FTSOs 
  let assets = ['XRP', 'LTC', 'XLM', 'XDG', 'ADA', 'ALGO', 'BCH', 'DGB', 'BTC'];


  for (let asset of assets) {
    if (!quiet) {
      console.error(`Rigging ${asset}...`);
    }

    let assetContracts = await deployNewAsset(
      contracts,
      deployerAccount.address,
      ftsoManager,
      supply.address,
      wnat.address,
      cleanupBlockNumberManager,
      rewrapXassetParams(parameters[asset]),
      parameters.priceDeviationThresholdBIPS,
      parameters.priceEpochCyclicBufferSize,
      quiet
    );
    assetToContracts.set(asset, {
      assetSymbol: asset,
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

  for (let asset of ['NAT', ...assets]) {
    let ftsoContract = (assetToContracts.get(asset) as AssetContracts).ftso;
    await waitFinalize3(deployerAccount.address, () => ftsoManager.addFtso(ftsoContract.address));
  }

  let registry = await FtsoRegistry.at(await ftsoManager.ftsoRegistry());

  // Set initial number of voters
  for (let asset of ['NAT', ...assets]) {

    const assetContract = assetToContracts.get(asset)!;
    const ftsoIndex = await registry.getFtsoIndex(await assetContract.ftso.symbol());
    await voterWhitelister.setMaxVotersForFtso(ftsoIndex, 100, { from: currentGovernanceAddress });
  }

  // Set FTSOs to multi Asset WNAT contract
  let multiAssets = ["XRP", "LTC", "XDG"]
  let multiAssetFtsos = multiAssets.map(asset => assetToContracts.get(asset)!.ftso!.address)
  // [ftsoFxrp.address, ftsoFltc.address, ftsoFxdg.address]
  await ftsoManager.setFtsoAssetFtsos(ftsoWnat.address, multiAssetFtsos);

  // Activate the managers
  if (!quiet) {
    console.error("Activating managers...");
  }
  await ftsoManager.activate();
  await ftsoRewardManager.activate();
  await dataAvailabilityRewardManager.activate();

  // Turn over governance
  if (!quiet) {
    console.error("Transfering governance...");
  }
  await supply.proposeGovernance(governanceAccount.address);
  await inflation.proposeGovernance(governanceAccount.address);
  await inflationAllocation.proposeGovernance(governanceAccount.address);
  await flareDaemon.proposeGovernance(governanceAccount.address);
  await ftsoRewardManager.proposeGovernance(governanceAccount.address);
  await dataAvailabilityRewardManager.proposeGovernance(governanceAccount.address);
  await ftsoManager.proposeGovernance(governanceAccount.address);
  await priceSubmitter.proposeGovernance(governanceAccount.address, { from: currentGovernanceAddress });
  await voterWhitelister.proposeGovernance(governanceAccount.address, { from: currentGovernanceAddress });

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
    ftsoContracts: ["WNAT", ...assets].map(asset => assetToContracts.get(asset))
    // Add other contracts as needed and fix the interface above accordingly
  } as DeployedFlareContracts;
}

async function deployNewAsset(
  contracts: Contracts,
  deployerAccountAddress: string,
  ftsoManager: FtsoManagerInstance,
  supplyAddress: string,
  wnatAddress: string,
  cleanupBlockNumberManager: CleanupBlockNumberManagerInstance,
  xAssetDefinition: AssetDefinition,
  priceDeviationThresholdBIPS: number,
  priceEpochCyclicBufferSize: number,
  quiet = false):
  Promise<{
    xAssetToken: AssetTokenInstance,
    dummyAssetMinter: DummyAssetMinterInstance,
    ftso: FtsoInstance
  }> {

  const DummyAssetMinter = artifacts.require("DummyAssetMinter");
  const AssetToken = artifacts.require("AssetToken");
  const Ftso = artifacts.require("Ftso");

  // Deploy Asset
  const xAssetToken = await AssetToken.new(deployerAccountAddress, xAssetDefinition.name, xAssetDefinition.symbol, xAssetDefinition.decimals);
  await setDefaultVPContract(xAssetToken, deployerAccountAddress);
  spewNewContractInfo(contracts, xAssetDefinition.symbol, xAssetToken.address, quiet);

  await cleanupBlockNumberManager.registerToken(xAssetToken.address);
  await xAssetToken.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);

  // Deploy dummy Asset minter
  const dummyAssetMinter = await DummyAssetMinter.new(xAssetToken.address, xAssetDefinition.maxMintRequestTwei);
  spewNewContractInfo(contracts, `Dummy ${xAssetDefinition.symbol} minter`, dummyAssetMinter.address, quiet);

  // Establish governance over Asset by minter
  await xAssetToken.proposeGovernance(dummyAssetMinter.address, { from: deployerAccountAddress });
  await dummyAssetMinter.claimGovernanceOverMintableToken();

  // Register an FTSO for the new Asset
  const ftso = await Ftso.new(xAssetDefinition.symbol, wnatAddress, ftsoManager.address, supplyAddress, xAssetDefinition.initialPriceUSD5Dec, priceDeviationThresholdBIPS, priceEpochCyclicBufferSize);
  await ftsoManager.setFtsoAsset(ftso.address, xAssetToken.address);
  spewNewContractInfo(contracts, `FTSO ${xAssetDefinition.symbol}`, ftso.address, quiet);

  return { xAssetToken, dummyAssetMinter, ftso };
}

function spewNewContractInfo(contracts: Contracts, name: string, address: string, quiet = false) {
  if (!quiet) {
    console.error(`${name} contract: `, address);
  }
  contracts.add(new Contract(pascalCase(name), address));
}

function rewrapXassetParams(data: any): AssetDefinition {
  return {
    name: data.xAssetName,
    symbol: data.xAssetSymbol,
    decimals: data.xAssetDecimals,
    maxMintRequestTwei: data.dummyAssetMinterMax,
    initialPriceUSD5Dec: data.initialPriceUSD5Dec
  }
}
