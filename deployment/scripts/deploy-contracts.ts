/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { pascalCase } from "pascal-case";
import { Contract, Contracts } from "./Contracts";
import { verifyParameters } from './verify-parameters';

export interface AssetDefinition {
  name: string;
  symbol: string;
  wSymbol: string;
  decimals: number;
  maxMintRequestTwei: number;
  initialPriceUSDDec5: number;
}

export interface AssetContracts {
  xAssetToken?: any;
  ftso: any;
  dummyAssetMinter?: any;
  definition?: AssetDefinition;
  assetSymbol: string;
}

export interface DeployedFlareContracts {
  cleanupBlockNumberManager: any,
  ftsoRewardManager: any,
  ftsoManager: any,
  flareDaemon: any,
  priceSubmitter: any,
  dataAvailabilityRewardManager: any | null,
  supply: any,
  inflationAllocation: any,
  stateConnector: any,
  ftsoRegistry: any,
  ftsoContracts: AssetContracts[]
}

// waitFinalize3 and setDefaultVPContract are duplicated from test helper library because imports contain hardhat runtime.
// Because this procedure now runs as a hardhat task, the hardhat runtime cannot be imported, as this procedure
// is now considered a part of the HH configuration.

/**
 * Finalization wrapper for web3/truffle. Needed on Flare network since account nonce has to increase
 * to have the transaction confirmed.
 * @param address 
 * @param func 
 * @returns 
 */
async function waitFinalize3(hre: HardhatRuntimeEnvironment, address: string, func: () => any) {
  const web3 = hre.web3;
  let nonce = await web3.eth.getTransactionCount(address);
  let res = await func();
  while ((await web3.eth.getTransactionCount(address)) == nonce) {
    await new Promise((resolve: any) => { setTimeout(() => { resolve() }, 1000) })
    // console.log("Waiting...")
  }
  return res;
}

interface IISetVpContract {
  address: string;
  setReadVpContract(_vpContract: string, txDetails?: any): Promise<any>;
  setWriteVpContract(_vpContract: string, txDetails?: any): Promise<any>;
  vpContractInitialized(): Promise<boolean>;
}

async function setDefaultVPContract(hre: HardhatRuntimeEnvironment, token: IISetVpContract, governance: string) {
  const artifacts = hre.artifacts;
  const VPContractContract = artifacts.require("VPContract");
  const replacement = await token.vpContractInitialized();
  const vpContract = await VPContractContract.new(token.address, replacement);
  await token.setWriteVpContract(vpContract.address, { from: governance });
  await token.setReadVpContract(vpContract.address, { from: governance });
}

export function ftsoContractForSymbol(contracts: DeployedFlareContracts, symbol: string) {
  return contracts.ftsoContracts.find(x => x.assetSymbol === symbol)
}
// import { serializedParameters } from "./DeploymentParameters";

export async function deployContracts(hre: HardhatRuntimeEnvironment, parameters: any, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;

  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
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
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, "0x0000000000000000000000000000000000000000", parameters.scheduledInflationPercentageBIPS);
  spewNewContractInfo(contracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);

  let deployDataAvailabilityRewardManager = parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0;

  // Initialize the state connector
  let stateConnector: any;
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
  let flareDaemon: any;
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
  let priceSubmitter: any;
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

  spewNewContractInfo(contracts, PriceSubmitter.contractName, "PriceSubmitter.sol", priceSubmitter.address, quiet);

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
  let dataAvailabilityRewardManager: any | null = null;

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
    const distribution = await Distribution.new(deployerAccount.address);
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
  await priceSubmitter.setContractAddresses(ftsoRegistry.address, voterWhitelister.address, ftsoManager.address);

  // Deploy wrapped native token
  const wnat = await WNAT.new(deployerAccount.address, parameters.wrappedNativeName, parameters.wrappedNativeSymbol);
  spewNewContractInfo(contracts, WNAT.contractName, `WNat.sol`, wnat.address, quiet);

  await setDefaultVPContract(hre, wnat, deployerAccount.address);
  await cleanupBlockNumberManager.registerToken(wnat.address);
  await wnat.setCleanupBlockNumberManager(cleanupBlockNumberManager.address)

  // Tell reward manager about contracts
  await ftsoRewardManager.setContractAddresses(inflation.address, ftsoManager.address, wnat.address);

  let assetToContracts = new Map<string, AssetContracts>();

  // Create a FTSO for WNAT
  let ftsoWnat: any;
  if (parameters.deployNATFtso) {
    ftsoWnat = await Ftso.new(parameters.nativeSymbol, priceSubmitter.address, wnat.address, ftsoManager.address, startTs, parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
    spewNewContractInfo(contracts, `FTSO ${parameters.wrappedNativeSymbol}`, `Ftso.sol`, ftsoWnat.address, quiet);

    assetToContracts.set(parameters.nativeSymbol, {
      xAssetToken: wnat,
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
      wnat.address,
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
    await ftsoManager.setFtsoAssetFtsos(ftsoWnat.address, multiAssetFtsos);
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
    // Add other contracts as needed and fix the interface above accordingly
  } as DeployedFlareContracts;
}

async function deployNewAsset(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  deployerAccountAddress: string,
  ftsoManager: any,
  priceSubmitterAddress: string,
  wnatAddress: string,
  cleanupBlockNumberManager: any,
  startTs: BN,
  priceEpochDurationSeconds: number,
  revealEpochDurationSeconds: number,
  xAssetDefinition: AssetDefinition,
  priceDeviationThresholdBIPS: number,
  priceEpochCyclicBufferSize: number,
  deployDummyTokensAndMinters = true,
  quiet = false
):
  Promise<
    {
      xAssetToken?: any,
      dummyAssetMinter?: any,
      ftso: any
    }
  > {

  const artifacts = hre.artifacts;
  const DummyAssetMinter = artifacts.require("DummyAssetMinter");
  const AssetToken = artifacts.require("AssetToken");
  const Ftso = artifacts.require("Ftso");

  // Register an FTSO for the new Asset
  const ftso = await Ftso.new(xAssetDefinition.symbol, priceSubmitterAddress, wnatAddress, ftsoManager.address, startTs, priceEpochDurationSeconds,
    revealEpochDurationSeconds,xAssetDefinition.initialPriceUSDDec5, priceDeviationThresholdBIPS, priceEpochCyclicBufferSize);
  spewNewContractInfo(contracts, `FTSO ${xAssetDefinition.symbol}`, `Ftso.sol`, ftso.address, quiet);

  // Deploy Asset if we are not deploying on real network
  if (deployDummyTokensAndMinters) {
    const xAssetToken = await AssetToken.new(deployerAccountAddress, xAssetDefinition.name, xAssetDefinition.wSymbol, xAssetDefinition.decimals);
    await setDefaultVPContract(hre, xAssetToken, deployerAccountAddress);
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
