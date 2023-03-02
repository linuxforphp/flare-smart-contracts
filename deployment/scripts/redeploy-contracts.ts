import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { FlareContractRegistryContract } from '../../typechain-truffle';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import {
  spewNewContractInfo,
  verifyParameters
} from './deploy-utils';


export async function redeployContracts(hre: HardhatRuntimeEnvironment, contracts: Contracts, parameters: ChainParameters, quiet: boolean = false) {

  function encodeContractNames(names: string[]): string[] {
    return names.map( name => encodeString(name) );
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

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const FlareContractRegistry: FlareContractRegistryContract = artifacts.require("FlareContractRegistry");

  // Flare contract registry
  const flareContractRegistry = await FlareContractRegistry.new(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
  spewNewContractInfo(contracts, null, FlareContractRegistry.contractName, `FlareContractRegistry.sol`, flareContractRegistry.address, quiet);

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }
}
