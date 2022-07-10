/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { GovernanceVotePowerContract, PollingRejectContract, WNatContract } from '../../typechain-truffle';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import { DeployedFlareGovernanceContracts, spewNewContractInfo } from './deploy-utils';

export async function deployContractsGovernance(hre: HardhatRuntimeEnvironment, parameters: ChainParameters, quiet: boolean = false) {
  // const web3 = hre.web3;
  // const artifacts = hre.artifacts;

  // // Define repository for created contracts
  // const contracts = new Contracts();
  // // Define address updater contracts names list
  // const addressUpdaterContracts: string[] = [];
  // // Define accounts in play for the deployment process
  // let deployerAccount: any;
  // let genesisGovernanceAccount: any;

  // try {
  //   deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  // } catch (e) {
  //   throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  // }

  // // Wire up the default account that will do the deployment
  // web3.eth.defaultAccount = deployerAccount.address;

  // // Contract definitions
  // const WNat: WNatContract = artifacts.require("WNat");
  // const GovernanceVotePower: GovernanceVotePowerContract = artifacts.require("GovernanceVotePower");
  // const PollingReject: PollingRejectContract = artifacts.require("PollingReject");

  // // Deploy wrapped native token
  // const wNat = await WNat.new(deployerAccount.address, parameters.wrappedNativeName, parameters.wrappedNativeSymbol);
  // spewNewContractInfo(contracts, addressUpdaterContracts, WNat.contractName, `WNat.sol`, wNat.address, quiet);
  // // await cleanupBlockNumberManager.registerToken(wNat.address);
  // // await wNat.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);

  // // Deploy governance vote power
  // const governanceVotePower = await GovernanceVotePower.new(wNat.address);
  // await wNat.setGovernanceVotePower(governanceVotePower.address);
  // spewNewContractInfo(contracts, addressUpdaterContracts, GovernanceVotePower.contractName, `GovernanceVotePower.sol`, governanceVotePower.address, quiet);


  // // Deploy polling reject
  // const pollingReject = await PollingReject.new(
  //   deployerAccount.address,
  //   parameters.ftsoRegistryAddress,
  //   governanceVotePower.address,
  //   [
  //     parameters.proposalThresholdBIPS, 
  //     parameters.votingDelaySeconds,
  //     parameters.votingPeriodSeconds,
  //     parameters.executionDelaySeconds,
  //     parameters.executionPeriodSeconds,
  //     parameters.quorumThresholdBIPS,
  //     parameters.votePowerLifeTimeDays,
  //     parameters.vpBlockPeriodSeconds
  //   ],
  //   parameters.rejectionThresholdBIPS,
  //   parameters.proposers,
  //   parameters.ftsoManagerAddress
  // );
  // spewNewContractInfo(contracts, addressUpdaterContracts, PollingReject.contractName, `PollingReject.sol`, pollingReject.address, quiet);

  // if (!quiet) {
  //   console.error("Contracts in JSON:");
  //   console.log(contracts.serialize());
  //   console.error("Deploy complete.");
  // }

  // return {
  //   governanceVP: governanceVotePower,
  //   pollingReject: pollingReject,
  //   contracts: contracts,
  // } as DeployedFlareGovernanceContracts;
}
