/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { CleanupBlockNumberManagerContract, FtsoManagerContract, PriceSubmitterContract, WNatContract } from '../../typechain-truffle';
import { Contracts } from "./Contracts";
import { AssetContracts, DeployedFlareContracts, deployNewAsset, rewrapBlockHeightParams, spewNewContractInfo, verifyParameters } from './deploy-utils';


export async function deployFtsoBlockHeight(hre: HardhatRuntimeEnvironment, oldContracts: Contracts, parameters: any, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;

  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
  // Define accounts in play for the deployment process
  let deployerAccount: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private key is correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  const FtsoManager: FtsoManagerContract = artifacts.require("FtsoManager");
  const CleanupBlockNumberManager: CleanupBlockNumberManagerContract = artifacts.require("CleanupBlockNumberManager");
  const PriceSubmitter: PriceSubmitterContract = artifacts.require("PriceSubmitter");
  const WNat: WNatContract = artifacts.require("WNat");

  const priceSubmitter = await PriceSubmitter.at(oldContracts.getContractAddress(Contracts.PRICE_SUBMITTER));
  spewNewContractInfo(contracts, null, PriceSubmitter.contractName, `PriceSubmitter.sol`, priceSubmitter.address, quiet);
  const wNat = await WNat.at(oldContracts.getContractAddress(Contracts.WNAT));
  spewNewContractInfo(contracts, null, WNat.contractName, `WNat.sol`, wNat.address, quiet);
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.at(oldContracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
  spewNewContractInfo(contracts, null, CleanupBlockNumberManager.contractName, `CleanupBlockNumberManager.sol`, cleanupBlockNumberManager.address, quiet);
  const ftsoManager = await FtsoManager.at(oldContracts.getContractAddress(Contracts.FTSO_MANAGER));
  spewNewContractInfo(contracts, null, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  const priceEpochConfiguration = await ftsoManager.getPriceEpochConfiguration();
  const startTs = priceEpochConfiguration[0];

  let assetToContracts = new Map<string, AssetContracts>();
  
  // Deploy FTSOs
  for (let blockHeight of parameters.blockHeights) {
    if (!quiet) {
      console.error(`Rigging ${blockHeight.assetSymbol}`);
    }

    let blockHeightContracts = await deployNewAsset(
      hre,
      contracts,
      deployerAccount.address,
      ftsoManager,
      priceSubmitter.address,
      wNat.address,
      cleanupBlockNumberManager,
      startTs, 
      parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds,
      rewrapBlockHeightParams(blockHeight),
      parameters.priceDeviationThresholdBIPS,
      parameters.priceEpochCyclicBufferSize,
      parameters.minimalFtsoRandom,
      false,
      quiet,
    );
    assetToContracts.set(blockHeight.assetSymbol, {
      assetSymbol: blockHeight.assetSymbol,
      ...blockHeightContracts
    });
  }

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  return {
    ftsoContracts: [
      ...parameters.blockHeights
    ].map(asset => assetToContracts.get(asset.xAssetSymbol))
  } as DeployedFlareContracts;
}
  