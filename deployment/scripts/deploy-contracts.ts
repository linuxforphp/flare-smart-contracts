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
  DummyFAssetMinterInstance,
  FAssetTokenInstance,
  FlareKeeperInstance,
  FtsoInstance,
  FtsoManagerInstance,
  FtsoRegistryInstance,
  PriceSubmitterInstance,
  StateConnectorInstance
} from "../../typechain-truffle";
import { Contract, Contracts } from "./Contracts";

// import { serializedParameters } from "./DeploymentParameters";

const BN = web3.utils.toBN;
const { constants, time } = require('@openzeppelin/test-helpers');

// const parameters = JSON.parse(serializedParameters);
const parameters = require(`../chain-config/${ process.env.CHAIN_CONFIG }.json`)


// inject private keys from .env, if they exist
if (process.env.DEPLOYER_PRIVATE_KEY) {
  parameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
}
if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
  parameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
}
if (process.env.GOVERNANCE_PRIVATE_KEY) {
  parameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
}

async function main(parameters: any) {
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
  const PriceSubmitter = artifacts.require("PriceSubmitter");
  const Supply = artifacts.require("Supply");
  const WFLR = artifacts.require("WFlr");

  // InflationAllocation contract
  // Inflation will be set to 0 for now...it will be set shortly.
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, constants.ZERO_ADDRESS, parameters.inflationPercentageBips);
  spewNewContractInfo(contracts, InflationAllocation.contractName, inflationAllocation.address);

  // Initialize the state connector
  let stateConnector: StateConnectorInstance;
  try {
    stateConnector = await StateConnector.at(parameters.stateConnectorAddress);
  } catch (e) {
    console.error("StateConnector not in genesis...creating new.")
    stateConnector = await StateConnector.new();
  }
  spewNewContractInfo(contracts, StateConnector.contractName, stateConnector.address);
  
try {
    stateConnector.initialiseChains();
  } catch (e) {
    // state connector might be already initialized if redeploy
  }

  // Initialize the keeper
  let flareKeeper: FlareKeeperInstance;
  try {
    flareKeeper = await FlareKeeper.at(parameters.flareKeeperAddress);
  } catch (e) {
    console.error("FlareKeeper not in genesis...creating new.")
    flareKeeper = await FlareKeeper.new();
  }
  spewNewContractInfo(contracts, FlareKeeper.contractName, flareKeeper.address);
  let currentGovernanceAddress = null;
  try {
    await flareKeeper.initialiseFixedAddress();
    currentGovernanceAddress = genesisGovernanceAccount.address;
  } catch (e) {
    // keeper might be already initialized if redeploy
    // NOTE: unregister must claim governance of flareKeeper!
    currentGovernanceAddress = governanceAccount.address
  }
  await flareKeeper.proposeGovernance(deployerAccount.address, { from: currentGovernanceAddress });
  await flareKeeper.claimGovernance({ from: deployerAccount.address });

  // Inflation contract
  // Get the timestamp for the just mined block
  const startTs = await time.latest();
  const inflation = await Inflation.new(
    deployerAccount.address,
    flareKeeper.address,
    inflationAllocation.address,
    inflationAllocation.address,
    startTs
  );
  spewNewContractInfo(contracts, Inflation.contractName, inflation.address);
  // The keeper needs a reference to the inflation contract.
  await flareKeeper.setInflation(inflation.address);
  // InflationAllocation needs a reference to the inflation contract.
  await inflationAllocation.setInflation(inflation.address);

  // Supply contract
  const supply = await Supply.new(
    deployerAccount.address,
    parameters.burnAddress,
    inflation.address,
    BN(parameters.totalFlrSupply).mul(BN(10).pow(BN(18))),
    BN(parameters.totalFoundationSupply).mul(BN(10).pow(BN(18))),
    []
  );
  spewNewContractInfo(contracts, Supply.contractName, supply.address);

  // FtsoRewardManager contract
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    parameters.rewardFeePercentageUpdateOffset,
    parameters.defaultRewardFeePercentage,
    parameters.ftsoRewardExpiryOffset,
    inflation.address);
  spewNewContractInfo(contracts, FtsoRewardManager.contractName, ftsoRewardManager.address);

  // ValidatorRewardManager contract
  const validatorRewardManager = await ValidatorRewardManager.new(
    deployerAccount.address,
    parameters.validatorRewardExpiryOffset,
    stateConnector.address,
    inflation.address);
  spewNewContractInfo(contracts, ValidatorRewardManager.contractName, validatorRewardManager.address);

  // Inflation allocation needs to know about reward managers
  await inflationAllocation.setSharingPercentages([ftsoRewardManager.address, validatorRewardManager.address], [8000, 2000]);
  // Supply contract needs to know about reward managers
  await supply.addRewardPool(ftsoRewardManager.address, 0);
  await supply.addRewardPool(validatorRewardManager.address, 0);

  // The inflation needs a reference to the supply contract.
  await inflation.setSupply(supply.address);

  // PriceSubmitter contract
  let priceSubmitter: PriceSubmitterInstance;
  try {
    priceSubmitter = await PriceSubmitter.at(parameters.priceSubmitterAddress);
  } catch (e) {
    console.error("PriceSubmitter not in genesis...creating new.")
    priceSubmitter = await PriceSubmitter.new();
  }
  spewNewContractInfo(contracts, PriceSubmitter.contractName, priceSubmitter.address);

  // Delayed reward epoch start time
  let rewardEpochStartTs = startTs.add(BN(Math.floor(parameters.rewardEpochsStartDelayInHours * 60 * 60)));

  // FtsoRegistryContract
  const ftsoRegistry = await FtsoRegistry.new(deployerAccount.address);

  // FtsoManager contract
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareKeeper.address,
    ftsoRewardManager.address,
    priceSubmitter.address,
    ftsoRegistry.address,
    parameters.priceEpochDurationSec,
    startTs,
    parameters.revealEpochDurationSec,
    parameters.rewardEpochDurationSec,
    rewardEpochStartTs,
    parameters.votePowerBoundaryFraction);
  spewNewContractInfo(contracts, FtsoManager.contractName, ftsoManager.address);

  await ftsoRegistry.setFtsoManagerAddress(ftsoManager.address);

  // Tell reward manager about ftso manager
  await ftsoRewardManager.setFTSOManager(ftsoManager.address);

  // Register kept contracts to the keeper...order matters. Inflation first.
  await flareKeeper.registerToKeep(inflation.address);
  await flareKeeper.registerToKeep(ftsoManager.address);

  // Deploy wrapped FLR
  const wflr = await WFLR.new(deployerAccount.address);
  await setDefaultVPContract(wflr, deployerAccount.address);
  spewNewContractInfo(contracts, WFLR.contractName, wflr.address);
  await ftsoRewardManager.setWFLR(wflr.address);

  // Create a non-FAsset FTSO
  // Register an FTSO for WFLR
  const ftsoWflr = await Ftso.new("WFLR", wflr.address, ftsoManager.address, supply.address, parameters.initialWflrPrice, parameters.priceDeviationThresholdBIPS);
  spewNewContractInfo(contracts, `FTSO WFLR`, ftsoWflr.address);

  // Deploy FAsset, minter, and ftso for XRP
  console.error("Rigging XRP...");
  const [, , ftsoFxrp] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    supply.address,
    wflr.address,
    parameters.XRP.fAssetName,
    parameters.XRP.fAssetSymbol,
    parameters.XRP.fAssetDecimals,
    parameters.XRP.dummyFAssetMinterMax,
    parameters.XRP.initialPrice,
    parameters.priceDeviationThresholdBIPS);

  // Deploy FAsset, minter, and ftso for LTC
  console.error("Rigging LTC...");
  const [, , ftsoFltc] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    supply.address,
    wflr.address,
    parameters.LTC.fAssetName,
    parameters.LTC.fAssetSymbol,
    parameters.LTC.fAssetDecimals,
    parameters.LTC.dummyFAssetMinterMax,
    parameters.LTC.initialPrice,
    parameters.priceDeviationThresholdBIPS);

  // Deploy FAsset, minter, and ftso for XDG
  console.error("Rigging XDG...");
  const [, , ftsoFxdg] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    supply.address,
    wflr.address,
    parameters.XDG.fAssetName,
    parameters.XDG.fAssetSymbol,
    parameters.XDG.fAssetDecimals,
    parameters.XDG.dummyFAssetMinterMax,
    parameters.XDG.initialPrice,
    parameters.priceDeviationThresholdBIPS);

  // Deploy FAsset, minter, and ftso for ADA
  console.error("Rigging ADA...");
  const [, , ftsoFada] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    supply.address,
    wflr.address,
    parameters.ADA.fAssetName,
    parameters.ADA.fAssetSymbol,
    parameters.ADA.fAssetDecimals,
    parameters.ADA.dummyFAssetMinterMax,
    parameters.ADA.initialPrice,
    parameters.priceDeviationThresholdBIPS);

  // Deploy FAsset, minter, and ftso for ALGO
  console.error("Rigging ALGO...");
  const [, , ftsoFalgo] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    supply.address,
    wflr.address,
    parameters.ALGO.fAssetName,
    parameters.ALGO.fAssetSymbol,
    parameters.ALGO.fAssetDecimals,
    parameters.ALGO.dummyFAssetMinterMax,
    parameters.ALGO.initialPrice,
    parameters.priceDeviationThresholdBIPS);

  // Deploy FAsset, minter, and ftso for BCH
  console.error("Rigging BCH...");
  const [, , ftsoFbch] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    supply.address,
    wflr.address,
    parameters.BCH.fAssetName,
    parameters.BCH.fAssetSymbol,
    parameters.BCH.fAssetDecimals,
    parameters.BCH.dummyFAssetMinterMax,
    parameters.BCH.initialPrice,
    parameters.priceDeviationThresholdBIPS);

  // Deploy FAsset, minter, and ftso for DGB
  console.error("Rigging DGB...");
  const [, , ftsoFdgb] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    supply.address,
    wflr.address,
    parameters.DGB.fAssetName,
    parameters.DGB.fAssetSymbol,
    parameters.DGB.fAssetDecimals,
    parameters.DGB.dummyFAssetMinterMax,
    parameters.DGB.initialPrice,
    parameters.priceDeviationThresholdBIPS);

  // Setup governance parameters for the ftso manager
  console.error("Setting FTSO manager governance parameters...");
  await ftsoManager.setGovernanceParameters(
    parameters.minVotePowerFlrThreshold,
    parameters.minVotePowerAssetThreshold,
    parameters.maxVotePowerFlrThreshold,
    parameters.maxVotePowerAssetThreshold,
    parameters.lowAssetUSDThreshold,
    parameters.highAssetUSDThreshold,
    parameters.highAssetTurnoutBIPSThreshold,
    parameters.lowFlrTurnoutBIPSThreshold,
    parameters.trustedAddresses);

  // Add ftsos to the ftso manager
  console.error("Adding FTSOs to manager...");
  await ftsoManager.addFtso(ftsoWflr.address);
  await ftsoManager.addFtso(ftsoFxrp.address);
  await ftsoManager.addFtso(ftsoFltc.address);
  await ftsoManager.addFtso(ftsoFxdg.address);

  await ftsoManager.addFtso(ftsoFada.address);
  await ftsoManager.addFtso(ftsoFalgo.address);
  await ftsoManager.addFtso(ftsoFbch.address);
  await ftsoManager.addFtso(ftsoFdgb.address);

  // Set FTSOs to multi FAsset WFLR contract
  await ftsoManager.setFtsoFAssetFtsos(ftsoWflr.address,
    [ftsoFxrp.address, ftsoFltc.address, ftsoFxdg.address]);

  // Activate the managers
  console.error("Activating managers...");
  await ftsoManager.activate();
  await ftsoRewardManager.activate();
  await validatorRewardManager.activate();

  // Turn over governance
  console.error("Transfering governance...");
  await supply.proposeGovernance(governanceAccount.address);
  await inflation.proposeGovernance(governanceAccount.address);
  await inflationAllocation.proposeGovernance(governanceAccount.address);
  await flareKeeper.proposeGovernance(governanceAccount.address);
  await ftsoRewardManager.proposeGovernance(governanceAccount.address);
  await validatorRewardManager.proposeGovernance(governanceAccount.address);
  await ftsoManager.proposeGovernance(governanceAccount.address);

  console.error("Contracts in JSON:");

  console.log(contracts.serialize());

  console.error("Deploy complete.");
}

async function deployNewFAsset(
  contracts: Contracts,
  deployerAccountAddress: string,
  ftsoManager: FtsoManagerInstance,
  supplyAddress: string,
  wflrAddress: string,
  name: string,
  symbol: string,
  decimals: number,
  maxMintRequestTwei: number,
  initialPrice: number,
  priceDeviationThresholdBIPS: number):
  Promise<[fAssetToken: FAssetTokenInstance,
    dummyFAssetMinter: DummyFAssetMinterInstance,
    ftso: FtsoInstance]> {

  const DummyFAssetMinter = artifacts.require("DummyFAssetMinter");
  const FAssetToken = artifacts.require("FAssetToken");
  const Ftso = artifacts.require("Ftso");

  // Deploy FAsset
  const fAssetToken = await FAssetToken.new(deployerAccountAddress, name, symbol, decimals);
  await setDefaultVPContract(fAssetToken, deployerAccountAddress);
  spewNewContractInfo(contracts, symbol, fAssetToken.address);

  // Deploy dummy FAsset minter
  const dummyFAssetMinter = await DummyFAssetMinter.new(fAssetToken.address, maxMintRequestTwei);
  spewNewContractInfo(contracts, `Dummy ${ symbol } minter`, dummyFAssetMinter.address);

  // Establish governance over FAsset by minter
  await fAssetToken.proposeGovernance(dummyFAssetMinter.address, { from: deployerAccountAddress });
  await dummyFAssetMinter.claimGovernanceOverMintableToken();

  // Register an FTSO for the new FAsset
  const ftso = await Ftso.new(symbol, wflrAddress, ftsoManager.address, supplyAddress,  initialPrice, priceDeviationThresholdBIPS);
  await ftsoManager.setFtsoFAsset(ftso.address, fAssetToken.address);
  spewNewContractInfo(contracts, `FTSO ${ symbol }`, ftso.address);

  return [fAssetToken, dummyFAssetMinter, ftso];
}

function spewNewContractInfo(contracts: Contracts, name: string, address: string) {
  console.error(`${ name } contract: `, address);
  contracts.add(new Contract(pascalCase(name), address));
}

main(parameters)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
