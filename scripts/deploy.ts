/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */
import { DummyFAssetMinterContract, 
  DummyFAssetMinterInstance, 
  FAssetTokenContract,
  FAssetTokenInstance,
  FlareKeeperContract,
  FtsoContract,
  FtsoManagerContract,
  FtsoInstance,
  InflationContract,
  RewardManagerContract,
  WFLRContract} from "../typechain-truffle";

import { pascalCase } from "pascal-case";

const BN = web3.utils.toBN;
const { constants, time } = require('@openzeppelin/test-helpers');

// XRP: 1 drop = 0.000001 XRP
// LTC: 1 litoshi = 0.00000001 LTC
// XDG: 1 shibe = 0.00000001 XDG (smallest unit name is uncertain; 10^-8 seems correct )
// Mint max is roughly set to $10,000 per coin
// These parameters derived from: https://docs.google.com/document/d/1r2e2i9WkfHDZuesDWPoXGNFnOQEwxOBdyZUtLZk7tWA/edit#
const serializedParameters = `{
  "flareKeeperAddress": "0x1000000000000000000000000000000000000002",
  "deployerPrivateKey": "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122",
  "governancePrivateKey": "0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb",
  "inflationFundWithdrawTimeLockSec": 10,
  "totalFlrSupply": 100000000000,
  "rewardEpochDurationSec": 172800,
  "revealEpochDurationSec": 30,
  "priceEpochDurationSec": 120,
  "votePowerBoundaryFraction": 0,
  "minVoteCount": 1,
  "minVotePowerFlrThreshold": 10000000000,
  "minVotePowerAssetThreshold": 10000000000,
  "maxVotePowerFlrThreshold": 10,
  "maxVotePowerAssetThreshold": 10,
  "lowAssetUSDThreshold": 200000000,
  "highAssetUSDThreshold": 3000000000,
  "highAssetTurnoutThreshold": 100,
  "XRP": {
    "fAssetName": "Flare Asset XRP",
    "fAssetSymbol": "FXRP",
    "fAssetDecimals": 6,
    "dummyFAssetMinterMax": 7000000000
  },
  "LTC": {
    "fAssetName": "Flare Asset Litecoin",
    "fAssetSymbol": "FLTC",
    "fAssetDecimals": 8,
    "dummyFAssetMinterMax": 4000000000
  },
  "XDG": {
    "fAssetName": "Flare Asset Dogecoin",
    "fAssetSymbol": "FXDG",
    "fAssetDecimals": 8,
    "dummyFAssetMinterMax": 13000000000000
  }
}`;

class Contract {
  name: string;
  address: string;

  constructor(name: string, address: string) {
    this.name = name;
    this.address = address;
  }
}

class Contracts {
  collection: Contract[];

  constructor() {
    this.collection = [];
  }

  add(contract: Contract) {
    this.collection.push(contract);
  }

  serialize(): string {
    return JSON.stringify(this.collection);
  }
}

const parameters = JSON.parse(serializedParameters);

async function main(parameters: any) {
  // Define repository for created contracts
  const contracts = new Contracts();

  // Define accounts in play for the deployment process
  const deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  const governanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const FlareKeeper = artifacts.require("FlareKeeper") as FlareKeeperContract;
  const Ftso = artifacts.require("Ftso") as FtsoContract;
  const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
  const Inflation = artifacts.require("Inflation") as InflationContract;
  const RewardManager = artifacts.require("RewardManager") as RewardManagerContract;
  const WFLR = artifacts.require("WFLR") as WFLRContract;

  // Inflation contract
  const inflation = await Inflation.new(deployerAccount.address, 
    parameters.inflationFundWithdrawTimeLockSec, 
    web3.utils.toWei(BN(parameters.totalFlrSupply)));
  spewNewContractInfo(contracts, Inflation.contractName, inflation.address);

  // RewardManager contract
  const rewardManager = await RewardManager.new(
    deployerAccount.address,
    inflation.address
  );
  spewNewContractInfo(contracts, RewardManager.contractName, rewardManager.address);

  // Tell inflation about the reward contract
  await inflation.setRewardContract(rewardManager.address);

  // FtsoManager contract
  // Get the timestamp for the just mined block
  const startTs = await time.latest();
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    rewardManager.address,
    parameters.priceEpochDurationSec,
    startTs,
    parameters.revealEpochDurationSec,
    parameters.rewardEpochDurationSec,
    startTs,
    parameters.votePowerBoundaryFraction);
  spewNewContractInfo(contracts, FtsoManager.contractName, ftsoManager.address);

  // Initialize the keeper
  const flareKeeper = await FlareKeeper.at(parameters.flareKeeperAddress);
  spewNewContractInfo(contracts, FlareKeeper.contractName, flareKeeper.address);
  await flareKeeper.initialise(deployerAccount.address);

  // Register kept contracts to the keeper
  await flareKeeper.registerToKeep(inflation.address);
  await flareKeeper.registerToKeep(ftsoManager.address);

  // Deploy wrapped FLR
  const wflr = await WFLR.new();
  spewNewContractInfo(contracts, WFLR.contractName, wflr.address);

  // Create a non-FAsset FTSO
  // Register an FTSO for WFLR
  const ftsoWflr = await Ftso.new(wflr.address, constants.ZERO_ADDRESS, rewardManager.address);
  spewNewContractInfo(contracts, `FTSO WFLR`, ftsoWflr.address);

  // Deploy FAsset, minter, and ftso for XRP
  console.error("Rigging XRP...");
  const [, ,ftsoFxrpWflr] = await deployNewFAsset(
    contracts,
    deployerAccount.address, 
    rewardManager.address, 
    wflr.address, 
    parameters.XRP.fAssetName, 
    parameters.XRP.fAssetSymbol,
    parameters.XRP.fAssetDecimals,
    parameters.XRP.dummyFAssetMinterMax);

  // Deploy FAsset, minter, and ftso for LTC
  console.error("Rigging LTC...");
  const [, ,ftsoFltcWflr] = await deployNewFAsset(
    contracts,
    deployerAccount.address, 
    rewardManager.address, 
    wflr.address, 
    parameters.LTC.fAssetName, 
    parameters.LTC.fAssetSymbol, 
    parameters.LTC.fAssetDecimals,
    parameters.LTC.dummyFAssetMinterMax);

  // Deploy FAsset, minter, and ftso for XDG
  console.error("Rigging XDG...");
  const [, ,ftsoFxdgWflr] = await deployNewFAsset(
    contracts,
    deployerAccount.address, 
    rewardManager.address, 
    wflr.address, 
    parameters.XDG.fAssetName, 
    parameters.XDG.fAssetSymbol, 
    parameters.XDG.fAssetDecimals,
    parameters.XDG.dummyFAssetMinterMax);

  // Setup governance parameters for the ftso manager
  console.error("Setting FTSO manager governance parameters...");
  await ftsoManager.setGovernanceParameters(
    parameters.minVoteCount,
    parameters.minVotePowerFlrThreshold,
    parameters.minVotePowerAssetThreshold,
    parameters.maxVotePowerFlrThreshold,
    parameters.maxVotePowerAssetThreshold,
    parameters.lowAssetUSDThreshold,
    parameters.highAssetUSDThreshold,
    parameters.highAssetTurnoutThreshold,
    [ftsoFxrpWflr.address, ftsoFltcWflr.address, ftsoFxdgWflr.address]
  );

  // Add ftsos to the ftso manager
  console.error("Adding FTSOs to manager...");
  await ftsoManager.addFtso(ftsoWflr.address);
  await ftsoManager.addFtso(ftsoFxrpWflr.address);
  await ftsoManager.addFtso(ftsoFltcWflr.address);
  await ftsoManager.addFtso(ftsoFxdgWflr.address);

  // Activate the managers
  console.error("Activating managers...");
  await ftsoManager.activate();
  await rewardManager.activate();

  // Turn over governance
  console.error("Transfering governance...");
  await flareKeeper.proposeGovernance(governanceAccount.address);
  await rewardManager.proposeGovernance(governanceAccount.address);
  await ftsoManager.proposeGovernance(governanceAccount.address);
  await inflation.proposeGovernance(governanceAccount.address);

  console.error("Contracts in JSON:");

  console.log(contracts.serialize());

  console.error("Deploy complete.");
}

async function deployNewFAsset(
  contracts: Contracts,
  deployerAccountAddress: string,
  rewardManagerAddress: string,
  wflrAddress: string, 
  name: string, 
  symbol: string,
  decimals: number, 
  maxMintRequestTwei: number):
  Promise<[fAssetToken: FAssetTokenInstance, 
    dummyFAssetMinter: DummyFAssetMinterInstance, 
    ftso: FtsoInstance]> {

  const DummyFAssetMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
  const FAssetToken = artifacts.require("FAssetToken") as FAssetTokenContract;
  const Ftso = artifacts.require("Ftso") as FtsoContract;

  // Deploy FAsset
  const fAssetToken = await FAssetToken.new(deployerAccountAddress, name, symbol, decimals);
  spewNewContractInfo(contracts, symbol, fAssetToken.address);

  // Deploy dummy FAsset minter
  const dummyFAssetMinter = await DummyFAssetMinter.new(fAssetToken.address, maxMintRequestTwei);
  spewNewContractInfo(contracts, `Dummy ${symbol} minter`, dummyFAssetMinter.address);

  // Establish governance over FAsset by minter
  await fAssetToken.proposeGovernance(dummyFAssetMinter.address, {from: deployerAccountAddress});
  await dummyFAssetMinter.claimGovernanceOverMintableToken();

  // Register an FTSO for the new FAsset
  const ftso = await Ftso.new(wflrAddress, fAssetToken.address, rewardManagerAddress);
  spewNewContractInfo(contracts, `FTSO ${symbol}/WFLR`, ftso.address);

  return [fAssetToken, dummyFAssetMinter, ftso];
}

function spewNewContractInfo(contracts: Contracts, name: string, address: string) {
  console.error(`${name} contract: `, address);
  contracts.add(new Contract(pascalCase(name), address));
}

main(parameters)
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });