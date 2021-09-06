/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { constants, time } from '@openzeppelin/test-helpers';
import { pascalCase } from "pascal-case";
import { waitFinalize3 } from "../../test/utils/test-helpers";
import { setDefaultVPContract } from "../../test/utils/token-test-helpers";
import {
  AssetTokenInstance, CleanupBlockNumberManagerInstance, DataAvailabilityRewardManagerInstance, DummyAssetMinterInstance, FlareDaemonInstance,
  FtsoInstance,
  FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerInstance, InflationAllocationInstance, PriceSubmitterInstance,
  StateConnectorInstance,
  SupplyInstance, WNatInstance
} from "../../typechain-truffle";
import { TestableFlareDaemonInstance } from "../../typechain-truffle/TestableFlareDaemon";
import { Contract, Contracts } from "./Contracts";

export interface AssetDefinition {
  name: string;
  symbol: string;
  wSymbol: string;
  decimals: number;
  maxMintRequestTwei: number;
  initialPriceUSDDec5: number;
}

export interface AssetContracts {
  xAssetToken?: AssetTokenInstance | WNatInstance;
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
  dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance | null,
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

// Here we should add certain verifications of parameters
export function verifyParameters(parameters: any) {
  // Inflation receivers
  if (!parameters.inflationReceivers) throw Error(`"inflationReceivers" parameter missing`);
  if (!parameters.inflationSharingBIPS) throw Error(`"inflationSharingBIPS" parameter missing`);
  if (!parameters.inflationTopUpTypes) throw Error(`"inflationTopUpTypes" parameter missing`);
  if (!parameters.inflationTopUpFactorsx100) throw Error(`"inflationTopUpFactorsx100" parameter missing`);

  if (new Set([
    parameters.inflationReceivers.length,
    parameters.inflationSharingBIPS.length,
    parameters.inflationTopUpTypes.length,
    parameters.inflationTopUpFactorsx100.length
  ]).size > 1) {
    throw Error(`Parameters "inflationReceivers", "inflationSharingBIPS", "inflationTopUpTypes" and "inflationTopUpFactorsx100" should be of the same size`)
  }

  // Reward epoch duration should be multiple >1 of price epoch
  if (
    parameters.rewardEpochDurationSeconds % parameters.priceEpochDurationSeconds != 0 ||
    parameters.rewardEpochDurationSeconds / parameters.priceEpochDurationSeconds == 1
  ) {
    throw Error(`"rewardEpochDurationSeconds" should be a multiple >1 of "priceEpochDurationSeconds"`)
  }

  // FtsoRewardManager must be inflation receiver
  if (parameters.inflationReceivers.indexOf("FtsoRewardManager") < 0) {
    throw Error(`FtsoRewardManager must be in "inflationReceivers"`)
  }

}

export async function fullDeploy(parameters: any, quiet: boolean = false) {
  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
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
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, constants.ZERO_ADDRESS, parameters.initialInflationPercentageBIPS);
  spewNewContractInfo(contracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);

  let deployDataAvailabilityRewardManager = parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0;

  // set scheduled inflation
  await inflationAllocation.setAnnualInflation(parameters.scheduledInflationPercentageBIPS)

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
  spewNewContractInfo(contracts, StateConnector.contractName, `StateConnector.sol`, stateConnector.address, quiet);

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
  spewNewContractInfo(contracts, FlareDaemon.contractName, `FlareDaemon.sol`, flareDaemon.address, quiet);

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
  spewNewContractInfo(contracts, PriceSubmitter.contractName, "PriceSubmitter.sol", priceSubmitter.address, quiet);

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

  spewNewContractInfo(contracts, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);
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
  spewNewContractInfo(contracts, Supply.contractName, `Supply.sol`, supply.address, quiet);

  // FtsoRewardManager contract
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    parameters.rewardFeePercentageUpdateOffsetEpochs,
    parameters.defaultRewardFeePercentageBIPS);
  spewNewContractInfo(contracts, FtsoRewardManager.contractName, `FtsoRewardManager.sol`, ftsoRewardManager.address, quiet);

  // DataAvailabilityRewardManager contract
  let dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance | null = null;

  if (deployDataAvailabilityRewardManager) {
    dataAvailabilityRewardManager = await DataAvailabilityRewardManager.new(
      deployerAccount.address,
      parameters.dataAvailabilityRewardExpiryOffsetEpochs,
      stateConnector.address,
      inflation.address);
    spewNewContractInfo(contracts, DataAvailabilityRewardManager.contractName, `DataAvailabilityRewardManager.sol`, dataAvailabilityRewardManager.address, quiet);
  }

  // CleanupBlockNumberManager contract
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.new(
    deployerAccount.address,
  );
  spewNewContractInfo(contracts, CleanupBlockNumberManager.contractName, `CleanupBlockNumberManager.sol`, cleanupBlockNumberManager.address, quiet);


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
  spewNewContractInfo(contracts, FtsoRegistry.contractName, `FtsoRegistry.sol`, ftsoRegistry.address, quiet);

  // VoterWhitelisting
  const voterWhitelister = await VoterWhitelister.new(deployerAccount.address, priceSubmitter.address, parameters.defaultVoterWhitelistSize);
  spewNewContractInfo(contracts, VoterWhitelister.contractName, `VoterWhitelister.sol`, voterWhitelister.address, quiet);

  // Distribution Contract
  if (parameters.deployDistributionContract) {
    const distribution = await Distribution.new();
    spewNewContractInfo(contracts, Distribution.contractName, `Distribution.sol`, distribution.address, quiet);
  }

  // FtsoManager contract
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareDaemon.address,
    priceSubmitter.address,
    startTs,
    parameters.priceEpochDurationSeconds,
    parameters.revealEpochDurationSeconds,
    rewardEpochStartTs,
    parameters.rewardEpochDurationSeconds,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  await ftsoManager.setContractAddresses(ftsoRewardManager.address, ftsoRegistry.address, voterWhitelister.address, supply.address, cleanupBlockNumberManager.address);
  await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address);
  await cleanupBlockNumberManager.setTriggerContractAddress(ftsoManager.address);

  await voterWhitelister.setContractAddresses(ftsoRegistry.address, ftsoManager.address);
  await priceSubmitter.setContractAddresses(ftsoRegistry.address, voterWhitelister.address, ftsoManager.address, { from: currentGovernanceAddress });

  // Deploy wrapped native token
  const wnat = await WNAT.new(deployerAccount.address, parameters.wrappedNativeName, parameters.wrappedNativeSymbol);
  spewNewContractInfo(contracts, WNAT.contractName, `WNat.sol`, wnat.address, quiet);

  await setDefaultVPContract(wnat, deployerAccount.address);
  await cleanupBlockNumberManager.registerToken(wnat.address);
  await wnat.setCleanupBlockNumberManager(cleanupBlockNumberManager.address)

  // Tell reward manager about contracts
  await ftsoRewardManager.setContractAddresses(inflation.address, ftsoManager.address, wnat.address);

  // Register daemonized contracts to the daemon...order matters. Inflation first.
  // Can only be registered after all inflation receivers know about inflation
  const registrations = [
    { daemonizedContract: inflation.address, gasLimit: parameters.inflationGasLimit },
    { daemonizedContract: ftsoManager.address, gasLimit: parameters.ftsoManagerGasLimit }
  ];
  await flareDaemon.registerToDaemonize(registrations);

  // Create a non-asset FTSO
  // Register an FTSO for WNAT
  const ftsoWnat = await Ftso.new(parameters.wrappedNativeSymbol, priceSubmitter.address, wnat.address, ftsoManager.address, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
  spewNewContractInfo(contracts, `FTSO ${parameters.wrappedNativeSymbol}`, `Ftso.sol`, ftsoWnat.address, quiet);

  let assetToContracts = new Map<string, AssetContracts>();
  assetToContracts.set("NAT", {
    xAssetToken: wnat,
    ftso: ftsoWnat,
    assetSymbol: 'NAT'
  })

  // Deploy asset, minter, and initial FTSOs 

  for (let asset of parameters.assets) {
    if (!quiet) {
      console.error(`Rigging ${asset.assetSymbol}...${parameters.deployDummyXAssetTokensAndMinters ? " with dummy token and minter" : ""}`);
    }

    let assetContracts = await deployNewAsset(
      contracts,
      deployerAccount.address,
      ftsoManager,
      priceSubmitter.address,
      wnat.address,
      cleanupBlockNumberManager,
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

  for (let asset of [{ assetSymbol: 'NAT' }, ...parameters.assets]) {
    let ftsoContract = (assetToContracts.get(asset.assetSymbol) as AssetContracts).ftso;
    await waitFinalize3(deployerAccount.address, () => ftsoManager.addFtso(ftsoContract.address));
  }

  // Set FTSOs to multi Asset WNAT contract
  let multiAssets = ["XRP", "LTC", "DOGE"]
  let multiAssetFtsos = multiAssets.map(asset => assetToContracts.get(asset)!.ftso!.address)
  // [ftsoFxrp.address, ftsoFltc.address, ftsoFxdg.address]
  await ftsoManager.setFtsoAssetFtsos(ftsoWnat.address, multiAssetFtsos);

  // Activate the managers
  if (!quiet) {
    console.error("Activating managers...");
  }
  await ftsoManager.activate();
  await ftsoRewardManager.activate();
  if (deployDataAvailabilityRewardManager) {
    await dataAvailabilityRewardManager!.activate();
  }

  // Turn over governance
  if (!quiet) {
    console.error("Transfering governance...");
  }
  await supply.proposeGovernance(governanceAccount.address);
  await inflation.proposeGovernance(governanceAccount.address);
  await inflationAllocation.proposeGovernance(governanceAccount.address);
  await flareDaemon.proposeGovernance(governanceAccount.address);
  await ftsoRewardManager.proposeGovernance(governanceAccount.address);
  if (deployDataAvailabilityRewardManager) {
    await dataAvailabilityRewardManager!.proposeGovernance(governanceAccount.address);
  }
  await ftsoManager.proposeGovernance(governanceAccount.address);
  await priceSubmitter.proposeGovernance(governanceAccount.address, { from: currentGovernanceAddress });
  await voterWhitelister.proposeGovernance(governanceAccount.address);

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
    ftsoContracts: [{ xAssetSymbol: 'WNAT' }, ...parameters.assets].map(asset => assetToContracts.get(asset.xAssetSymbol))
    // ftsoContracts: ["NAT", ...assets].map(asset => assetToContracts.get(asset)) !!!
    // Add other contracts as needed and fix the interface above accordingly
  } as DeployedFlareContracts;
}

async function deployNewAsset(
  contracts: Contracts,
  deployerAccountAddress: string,
  ftsoManager: FtsoManagerInstance,
  priceSubmitterAddress: string,
  wnatAddress: string,
  cleanupBlockNumberManager: CleanupBlockNumberManagerInstance,
  xAssetDefinition: AssetDefinition,
  priceDeviationThresholdBIPS: number,
  priceEpochCyclicBufferSize: number,
  deployDummyTokensAndMinters = true,
  quiet = false
):
  Promise<
    {
      xAssetToken?: AssetTokenInstance,
      dummyAssetMinter?: DummyAssetMinterInstance,
      ftso: FtsoInstance
    }
  > {

  const DummyAssetMinter = artifacts.require("DummyAssetMinter");
  const AssetToken = artifacts.require("AssetToken");
  const Ftso = artifacts.require("Ftso");

  // Register an FTSO for the new Asset
  const ftso = await Ftso.new(xAssetDefinition.symbol, priceSubmitterAddress, wnatAddress, ftsoManager.address, xAssetDefinition.initialPriceUSDDec5, priceDeviationThresholdBIPS, priceEpochCyclicBufferSize);
  spewNewContractInfo(contracts, `FTSO ${xAssetDefinition.symbol}`, `Ftso.sol`, ftso.address, quiet);

  // Deploy Asset if we are not deploying on real network
  if (deployDummyTokensAndMinters) {
    const xAssetToken = await AssetToken.new(deployerAccountAddress, xAssetDefinition.name, xAssetDefinition.wSymbol, xAssetDefinition.decimals);
    await setDefaultVPContract(xAssetToken, deployerAccountAddress);
    spewNewContractInfo(contracts, xAssetDefinition.wSymbol, `AssetToken.sol`, xAssetToken.address, quiet, false);

    await cleanupBlockNumberManager.registerToken(xAssetToken.address);
    await xAssetToken.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);

    // Deploy dummy Asset minter
    const dummyAssetMinter = await DummyAssetMinter.new(xAssetToken.address, xAssetDefinition.maxMintRequestTwei);
    spewNewContractInfo(contracts, `Dummy ${xAssetDefinition.wSymbol} minter`, `DummyAssetMinter.sol`, dummyAssetMinter.address, quiet, false);


    // Establish governance over Asset by minter !!!
    await xAssetToken.proposeGovernance(dummyAssetMinter.address, { from: deployerAccountAddress });
    await dummyAssetMinter.claimGovernanceOverMintableToken();

    await ftsoManager.setFtsoAsset(ftso.address, xAssetToken.address);

    return { xAssetToken, dummyAssetMinter, ftso };
  }

  return { ftso }

}

function spewNewContractInfo(contracts: Contracts, name: string, contractName: string, address: string, quiet = false, pascal = true) {
  if (!quiet) {
    console.error(`${name} contract: `, address);
  }
  if (pascal) {
    contracts.add(new Contract(pascalCase(name), contractName, address));
  }
  else {
    contracts.add(new Contract(name.replace(/\s/g, ""), contractName, address));
  }
}

function rewrapXassetParams(data: any): AssetDefinition {
  return {
    name: data.xAssetName,
    symbol: data.assetSymbol,
    wSymbol: data.xAssetSymbol,
    decimals: data.assetDecimals,
    maxMintRequestTwei: data.dummyAssetMinterMax,
    initialPriceUSDDec5: data.initialPriceUSDDec5
  }
}
