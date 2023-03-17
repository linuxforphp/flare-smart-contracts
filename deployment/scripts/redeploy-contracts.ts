import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AddressUpdaterContract, FlareContractRegistryContract, PollingFtsoContract, VoterWhitelisterContract } from '../../typechain-truffle';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import {
  spewNewContractInfo,
  verifyParameters
} from './deploy-utils';


export async function redeployContracts(hre: HardhatRuntimeEnvironment, contracts: Contracts, parameters: ChainParameters, quiet: boolean = false) {

  function encodeContractNames(names: string[]): string[] {
    return names.map(name => encodeString(name));
  }

  function encodeString(text: string): string {
    return hre.ethers.utils.keccak256(hre.ethers.utils.defaultAbiCoder.encode(["string"], [text]));
  }

  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;


  verifyParameters(parameters);
  // Define accounts in play for the deployment process
  let deployerAccount: any;
  // Define address updater contracts names list
  const addressUpdaterContracts: string[] = [];

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const VoterWhitelister: VoterWhitelisterContract = artifacts.require("VoterWhitelister");
  const PollingFtso: PollingFtsoContract = artifacts.require("PollingFtso");

  // Voter whitelister
  const voterWhitelister = await VoterWhitelister.new(
    parameters.governancePublicKey,
    deployerAccount.address,
    parameters.priceSubmitterAddress,
    parameters.defaultVoterWhitelistSize,
    contracts.getContractAddress(Contracts.VOTER_WHITELISTER)); // old voter whitelister
  spewNewContractInfo(contracts, addressUpdaterContracts, VoterWhitelister.contractName, `VoterWhitelister.sol`, voterWhitelister.address, quiet);

  await voterWhitelister.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
    [contracts.getContractAddress(Contracts.ADDRESS_UPDATER), contracts.getContractAddress(Contracts.FTSO_REGISTRY), contracts.getContractAddress(Contracts.FTSO_MANAGER)]);

  // Deploy polling ftso
  const pollingFtso = await PollingFtso.new(
    deployerAccount.address,
    deployerAccount.address
  );
  await pollingFtso.setMaintainer(deployerAccount.address);
  await pollingFtso.setParameters( // can be called only from maintainer address
    parameters.votingDelaySeconds,
    parameters.votingPeriodSeconds,
    parameters.thresholdConditionBIPS,
    parameters.majorityConditionBIPS,
    BN(parameters.proposalFeeValueNAT).mul(BN(10).pow(BN(18))),
    parameters.addAfterRewardedEpochs,
    parameters.addAfterNotChilledEpochs,
    parameters.removeAfterNotRewardedEpochs,
    parameters.removeAfterEligibleProposals,
    parameters.removeAfterNonParticipatingProposals,
    parameters.removeForDays
  );
  await pollingFtso.setMaintainer(parameters.maintainer);
  spewNewContractInfo(contracts, addressUpdaterContracts, PollingFtso.contractName, `PollingFtso.sol`, pollingFtso.address, quiet);


  await pollingFtso.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.VOTER_WHITELISTER, Contracts.FTSO_REWARD_MANAGER, Contracts.SUPPLY]),
    [contracts.getContractAddress(Contracts.ADDRESS_UPDATER), voterWhitelister.address, contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER), contracts.getContractAddress(Contracts.SUPPLY)]);


  // switch to production mode
  await pollingFtso.switchToProductionMode();


  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }
}
