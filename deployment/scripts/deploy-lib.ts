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
  DummyFAssetMinterInstance,
  FAssetTokenInstance,
  FlareKeeperInstance,
  FtsoInstance,
  FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerInstance, InflationAllocationInstance, PriceSubmitterInstance,
  StateConnectorInstance,
  SupplyInstance,
  ValidatorRewardManagerInstance,
  WFlrInstance
} from "../../typechain-truffle";
import { Contract, Contracts } from "./Contracts";

export interface FAssetDefinition {
  name: string;
  symbol: string;
  decimals: number;
  maxMintRequestTwei: number;
  initialPriceUSD5Dec: number;
}

export interface AssetContracts {
  fAssetToken: FAssetTokenInstance | WFlrInstance;
  ftso: FtsoInstance;
  dummyFAssetMinter?: DummyFAssetMinterInstance;
  definition?: FAssetDefinition;
  assetSymbol: string;
}

export interface DeployedFlareContracts {
  cleanupBlockNumberManager: CleanupBlockNumberManagerInstance,
  ftsoRewardManager: FtsoRewardManagerInstance,
  ftsoManager: FtsoManagerInstance,
  flareKeeper: FlareKeeperInstance,
  priceSubmitter: PriceSubmitterInstance,
  validatorRewardManager: ValidatorRewardManagerInstance,
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
  const FlareKeeper = artifacts.require("FlareKeeper");
  const Ftso = artifacts.require("Ftso");
  const FtsoManager = artifacts.require("FtsoManager");
  const Inflation = artifacts.require("Inflation");
  const FtsoRegistry = artifacts.require("FtsoRegistry");
  const FtsoRewardManager = artifacts.require("FtsoRewardManager");
  const ValidatorRewardManager = artifacts.require("ValidatorRewardManager");
  const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
  const PriceSubmitter = artifacts.require("PriceSubmitter");
  const Supply = artifacts.require("Supply");
  const VoterWhitelister = artifacts.require("VoterWhitelister");
  const WFLR = artifacts.require("WFlr");
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

  // Initialize the keeper
  let flareKeeper: FlareKeeperInstance;
  try {
    flareKeeper = await FlareKeeper.at(parameters.flareKeeperAddress);
  } catch (e) {
    if (!quiet) {
      console.error("FlareKeeper not in genesis...creating new.")
    }
    flareKeeper = await FlareKeeper.new();
  }
  spewNewContractInfo(contracts, FlareKeeper.contractName, flareKeeper.address, quiet);


  try {
    await flareKeeper.initialiseFixedAddress();
  } catch (e) {
    console.error(`flareKeeper.initializeChains() failed. Ignore if redeploy. Error = ${e}`);
  }

  let currentGovernanceAddress = await flareKeeper.governance()

  // Unregister whatever is registered with verification
  while (true) {
    try {
      let lastAddress = await flareKeeper.keepContracts(0);
      console.error("Unregistring contracts");
      try {
        await waitFinalize3(currentGovernanceAddress, () => flareKeeper.registerToKeep([], { from: currentGovernanceAddress }));
      } catch (ee) {
        console.error("Error while unregistring. ", ee)
      }
    } catch (e) {
      console.error("No more kept contracts")
      break;
    }
  }

  await flareKeeper.proposeGovernance(deployerAccount.address, { from: currentGovernanceAddress });
  await flareKeeper.claimGovernance({ from: deployerAccount.address });
  // Set the block holdoff should a kept contract exceeded its max gas allocation
  await flareKeeper.setBlockHoldoff(parameters.flareKeeperGasExceededHoldoffBlocks);

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



  // Inflation contract
  // Get the timestamp for the just mined block
  const startTs = await time.latest();

  // Delayed reward epoch start time
  const rewardEpochStartTs = startTs.add(BN(Math.floor(parameters.rewardEpochsStartDelayHours * 60 * 60)));

  const inflation = await Inflation.new(
    deployerAccount.address,
    flareKeeper.address,
    inflationAllocation.address,
    inflationAllocation.address,
    startTs
  );
  spewNewContractInfo(contracts, Inflation.contractName, inflation.address, quiet);
  // The keeper needs a reference to the inflation contract.
  await flareKeeper.setInflation(inflation.address);
  // InflationAllocation needs a reference to the inflation contract.
  await inflationAllocation.setInflation(inflation.address);

  // Supply contract
  const supply = await Supply.new(
    deployerAccount.address,
    parameters.burnAddress,
    inflation.address,
    BN(parameters.totalFlareSupplyFLR).mul(BN(10).pow(BN(18))),
    BN(parameters.totalFoundationSupplyFLR).mul(BN(10).pow(BN(18))),
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

  // ValidatorRewardManager contract
  const validatorRewardManager = await ValidatorRewardManager.new(
    deployerAccount.address,
    parameters.validatorRewardExpiryOffsetEpochs,
    stateConnector.address,
    inflation.address);
  spewNewContractInfo(contracts, ValidatorRewardManager.contractName, validatorRewardManager.address, quiet);

  // ValidatorRewardManager contract
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.new(
    deployerAccount.address,
  );
  spewNewContractInfo(contracts, CleanupBlockNumberManager.contractName, cleanupBlockNumberManager.address, quiet);


  // Inflation allocation needs to know about reward managers
  await inflationAllocation.setSharingPercentages([ftsoRewardManager.address, validatorRewardManager.address], [8000, 2000]);
  // Supply contract needs to know about reward managers
  await supply.addRewardPool(ftsoRewardManager.address, 0);
  await supply.addRewardPool(validatorRewardManager.address, 0);

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
    flareKeeper.address,
    ftsoRewardManager.address,
    priceSubmitter.address,
    ftsoRegistry.address,
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

  await priceSubmitter.setFtsoRegistry(ftsoRegistry.address, { from: currentGovernanceAddress });
  await priceSubmitter.setFtsoManager(ftsoManager.address, { from: currentGovernanceAddress });
  await priceSubmitter.setVoterWhitelister(voterWhitelister.address, { from: currentGovernanceAddress });

  // Tell reward manager about ftso manager
  await ftsoRewardManager.setFTSOManager(ftsoManager.address);

  // Register kept contracts to the keeper...order matters. Inflation first.
  const registrations = [
    { keptContract: inflation.address, gasLimit: 10000000 },
    { keptContract: ftsoManager.address, gasLimit: 10000000 }
  ];
  await flareKeeper.registerToKeep(registrations);

  // Deploy wrapped FLR
  const wflr = await WFLR.new(deployerAccount.address);
  spewNewContractInfo(contracts, WFLR.contractName, wflr.address, quiet);

  await setDefaultVPContract(wflr, deployerAccount.address);
  await cleanupBlockNumberManager.registerToken(wflr.address);
  await wflr.setCleanupBlockNumberManager(cleanupBlockNumberManager.address)


  await ftsoRewardManager.setWFLR(wflr.address);

  // Create a non-FAsset FTSO
  // Register an FTSO for WFLR
  const ftsoWflr = await Ftso.new("WFLR", wflr.address, ftsoManager.address, supply.address, parameters.initialWflrPriceUSD5Dec, parameters.priceDeviationThresholdBIPS);
  spewNewContractInfo(contracts, `FTSO WFLR`, ftsoWflr.address, quiet);

  let assetToContracts = new Map<string, AssetContracts>();
  assetToContracts.set("FLR", {
    fAssetToken: wflr,
    ftso: ftsoWflr,
    assetSymbol: 'FLR'
  })

  // Deploy FAsset, minter, and initial FTSOs 
  let assets = ['XRP', 'LTC', 'XLM', 'XDG', 'ADA', 'ALGO', 'BCH', 'DGB', 'BTC'];


  for (let asset of assets) {
    if (!quiet) {
      console.error(`Rigging ${asset}...`);
    }

    let assetContracts = await deployNewFAsset(
      contracts,
      deployerAccount.address,
      ftsoManager,
      supply.address,
      wflr.address,
      cleanupBlockNumberManager,
      rewrapFassetParams(parameters[asset]),
      parameters.priceDeviationThresholdBIPS,
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
    parameters.maxVotePowerFlrThresholdFraction,
    parameters.maxVotePowerAssetThresholdFraction,
    parameters.lowAssetThresholdUSDDec5,
    parameters.highAssetThresholdUSDDec5,
    parameters.highAssetTurnoutThresholdBIPS,
    parameters.lowFlrTurnoutThresholdBIPS,
    Math.floor(parameters.ftsoRewardExpiryOffsetDays * 60 * 60 * 24),
    parameters.trustedAddresses);

  // Add ftsos to the ftso manager
  if (!quiet) {
    console.error("Adding FTSOs to manager...");
  }

  for (let asset of ['FLR', ...assets]) {
    let ftsoContract = (assetToContracts.get(asset) as AssetContracts).ftso;
    await ftsoManager.addFtso(ftsoContract.address);
  }

  let registry = await FtsoRegistry.at(await ftsoManager.ftsoRegistry());

  // Set initial number of voters
  for (let asset of ['FLR', ...assets]) {

    const assetContract = assetToContracts.get(asset)!;
    const ftsoIndex = await registry.getFtsoIndex(await assetContract.ftso.symbol());
    await voterWhitelister.setMaxVotersForFtso(ftsoIndex, 100, { from: currentGovernanceAddress });
  }

  // Set FTSOs to multi FAsset WFLR contract
  let multiAssets = ["XRP", "LTC", "XDG"]
  let multiAssetFtsos = multiAssets.map(asset => assetToContracts.get(asset)!.ftso!.address)
  // [ftsoFxrp.address, ftsoFltc.address, ftsoFxdg.address]
  await ftsoManager.setFtsoFAssetFtsos(ftsoWflr.address, multiAssetFtsos);

  // Activate the managers
  if (!quiet) {
    console.error("Activating managers...");
  }
  await ftsoManager.activate();
  await ftsoRewardManager.activate();
  await validatorRewardManager.activate();

  // Turn over governance
  if (!quiet) {
    console.error("Transfering governance...");
  }
  await supply.proposeGovernance(governanceAccount.address);
  await inflation.proposeGovernance(governanceAccount.address);
  await inflationAllocation.proposeGovernance(governanceAccount.address);
  await flareKeeper.proposeGovernance(governanceAccount.address);
  await ftsoRewardManager.proposeGovernance(governanceAccount.address);
  await validatorRewardManager.proposeGovernance(governanceAccount.address);
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
    flareKeeper: flareKeeper,
    priceSubmitter: priceSubmitter,
    validatorRewardManager: validatorRewardManager,
    supply: supply,
    inflationAllocation: inflationAllocation,
    stateConnector: stateConnector,
    ftsoRegistry: ftsoRegistry,
    ftsoContracts: ["WFLR", ...assets].map(asset => assetToContracts.get(asset))
    // Add other contracts as needed and fix the interface above accordingly
  } as DeployedFlareContracts;
}

async function deployNewFAsset(
  contracts: Contracts,
  deployerAccountAddress: string,
  ftsoManager: FtsoManagerInstance,
  supplyAddress: string,
  wflrAddress: string,
  cleanupBlockNumberManager: CleanupBlockNumberManagerInstance,
  fAssetDefinition: FAssetDefinition,
  priceDeviationThresholdBIPS: number,
  quiet = false):
  Promise<{
    fAssetToken: FAssetTokenInstance,
    dummyFAssetMinter: DummyFAssetMinterInstance,
    ftso: FtsoInstance
  }> {

  const DummyFAssetMinter = artifacts.require("DummyFAssetMinter");
  const FAssetToken = artifacts.require("FAssetToken");
  const Ftso = artifacts.require("Ftso");

  // Deploy FAsset
  const fAssetToken = await FAssetToken.new(deployerAccountAddress, fAssetDefinition.name, fAssetDefinition.symbol, fAssetDefinition.decimals);
  await setDefaultVPContract(fAssetToken, deployerAccountAddress);
  spewNewContractInfo(contracts, fAssetDefinition.symbol, fAssetToken.address, quiet);

  await cleanupBlockNumberManager.registerToken(fAssetToken.address);
  await fAssetToken.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);

  // Deploy dummy FAsset minter
  const dummyFAssetMinter = await DummyFAssetMinter.new(fAssetToken.address, fAssetDefinition.maxMintRequestTwei);
  spewNewContractInfo(contracts, `Dummy ${fAssetDefinition.symbol} minter`, dummyFAssetMinter.address, quiet);

  // Establish governance over FAsset by minter
  await fAssetToken.proposeGovernance(dummyFAssetMinter.address, { from: deployerAccountAddress });
  await dummyFAssetMinter.claimGovernanceOverMintableToken();

  // Register an FTSO for the new FAsset
  const ftso = await Ftso.new(fAssetDefinition.symbol, wflrAddress, ftsoManager.address, supplyAddress, fAssetDefinition.initialPriceUSD5Dec, priceDeviationThresholdBIPS);
  await ftsoManager.setFtsoFAsset(ftso.address, fAssetToken.address);
  spewNewContractInfo(contracts, `FTSO ${fAssetDefinition.symbol}`, ftso.address, quiet);

  return { fAssetToken, dummyFAssetMinter, ftso };
}

function spewNewContractInfo(contracts: Contracts, name: string, address: string, quiet = false) {
  if (!quiet) {
    console.error(`${name} contract: `, address);
  }
  contracts.add(new Contract(pascalCase(name), address));
}

function rewrapFassetParams(data: any): FAssetDefinition {
  return {
    name: data.fAssetName,
    symbol: data.fAssetSymbol,
    decimals: data.fAssetDecimals,
    maxMintRequestTwei: data.dummyFAssetMinterMax,
    initialPriceUSD5Dec: data.initialPriceUSD5Dec
  }
}
