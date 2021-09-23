/**
 * This script will redeploy Inflation, InflationAllocaton, Supply and reward managers.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed (+ old FlareDaemon, FtsoManager, WNAT and StateConnector).
 * It will write out to stderr, status info as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { pascalCase } from "pascal-case";
import { Contract, Contracts } from "./Contracts";
import { verifyParameters } from './verify-parameters';


export interface DeployedFlareContracts {
  ftsoRewardManager: any,
  dataAvailabilityRewardManager: any,
  supply: any,
  inflationAllocation: any,
  inflation: any,
}

export async function inflationContractsFix(hre: HardhatRuntimeEnvironment, oldContracts: Contracts, parameters: any, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;

  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
  // Define accounts in play for the deployment process
  let deployerAccount: any;
  let newGovernanceAccountAddress: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
    newGovernanceAccountAddress = parameters.governancePublicKey;
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const StateConnector = artifacts.require("StateConnector");
  const FlareDaemon = artifacts.require("FlareDaemon");
  const FtsoManager = artifacts.require("FtsoManager");
  const WNAT = artifacts.require("WNat");
  const InflationAllocation = artifacts.require("InflationAllocation");
  const Inflation = artifacts.require("Inflation");
  const FtsoRewardManager = artifacts.require("FtsoRewardManager");
  const DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");
  const Supply = artifacts.require("Supply");
  
  const stateConnector = await StateConnector.at(oldContracts.getContractAddress(Contracts.STATE_CONNECTOR));
  spewNewContractInfo(contracts, StateConnector.contractName, `StateConnector.sol`, stateConnector.address, quiet);
  const flareDaemon = await FlareDaemon.at(oldContracts.getContractAddress(Contracts.FLARE_DAEMON));
  spewNewContractInfo(contracts, FlareDaemon.contractName, `FlareDaemon.sol`, flareDaemon.address, quiet);
  const ftsoManager = await FtsoManager.at(oldContracts.getContractAddress(Contracts.FTSO_MANAGER));
  spewNewContractInfo(contracts, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);
  const wnat = await WNAT.at(oldContracts.getContractAddress(Contracts.WNAT));
  spewNewContractInfo(contracts, WNAT.contractName, `WNat.sol`, wnat.address, quiet);

  // InflationAllocation contract
  // Inflation will be set to 0 for now...it will be set shortly.
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, "0x0000000000000000000000000000000000000000", parameters.initialInflationPercentageBIPS);
  spewNewContractInfo(contracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);

  let deployDataAvailabilityRewardManager = parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0;

  // set scheduled inflation
  await inflationAllocation.setAnnualInflation(parameters.scheduledInflationPercentageBIPS)

  // Get the timestamp for the just mined block
  // let currentBlock = await web3.eth.getBlock(await web3.eth.getBlockNumber());
  // const startTs = BN(currentBlock.timestamp);
  const startTs = BN(1631824801);

  // Inflation contract
  const inflation = await Inflation.new(
    deployerAccount.address,
    flareDaemon.address,
    inflationAllocation.address,
    inflationAllocation.address,
    startTs
  );

  spewNewContractInfo(contracts, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);

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

  // Tell reward manager about contracts
  await ftsoRewardManager.setContractAddresses(inflation.address, ftsoManager.address, wnat.address);

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  // Activate the manager
  if (!quiet) {
    console.error("Activating managers...");
  }
  await ftsoRewardManager.activate();
  if (deployDataAvailabilityRewardManager) {
    await dataAvailabilityRewardManager.activate();
  }

  if (!quiet) {
    console.error("Managers activated.");
  }
  
  // Turn over governance
  if (!quiet) {
    console.error("Transfering governance...");
    console.error(`Transfering with address ${deployerAccount.address}`);
    console.error(`Transfer to address ${newGovernanceAccountAddress}`);
  }

  await supply.transferGovernance(newGovernanceAccountAddress);
  await inflation.transferGovernance(newGovernanceAccountAddress);
  await inflationAllocation.transferGovernance(newGovernanceAccountAddress);
  await ftsoRewardManager.transferGovernance(newGovernanceAccountAddress);
  if (deployDataAvailabilityRewardManager) {
    await dataAvailabilityRewardManager.transferGovernance(newGovernanceAccountAddress);
  }

  if (!quiet) {
    console.error("Governance transfered.");
  }

  return {
    ftsoRewardManager: ftsoRewardManager,
    dataAvailabilityRewardManager: dataAvailabilityRewardManager,
    supply: supply,
    inflationAllocation: inflationAllocation,
    inflation: inflation,
    // Add other contracts as needed and fix the interface above accordingly
  } as DeployedFlareContracts;
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
