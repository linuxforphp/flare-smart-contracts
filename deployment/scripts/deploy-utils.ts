import { HardhatRuntimeEnvironment } from "hardhat/types";
import { pascalCase } from "pascal-case";
import { AssetTokenContract, AssetTokenInstance, CleanupBlockNumberManagerInstance, DataAvailabilityRewardManagerInstance, DummyAssetMinterContract, DummyAssetMinterInstance, FlareDaemonInstance, FtsoContract, FtsoInstance, FtsoManagerInstance, FtsoRegistryInstance, FtsoRewardManagerInstance, InflationAllocationInstance, PriceSubmitterInstance, StateConnectorInstance, SupplyInstance, TestableFlareDaemonInstance, WNatInstance } from "../../typechain-truffle";
import { Contract, Contracts } from "./Contracts";

export interface AssetDefinition {
  name: string;
  symbol: string;
  wSymbol: string;
  decimals: number;
  ftsoDecimals: number;
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
  cleanupBlockNumberManager?: CleanupBlockNumberManagerInstance,
  ftsoRewardManager?: FtsoRewardManagerInstance,
  ftsoManager?: FtsoManagerInstance,
  flareDaemon?: FlareDaemonInstance | TestableFlareDaemonInstance,
  priceSubmitter?: PriceSubmitterInstance,
  dataAvailabilityRewardManager?: DataAvailabilityRewardManagerInstance,
  supply?: SupplyInstance,
  inflationAllocation?: InflationAllocationInstance,
  stateConnector?: StateConnectorInstance,
  ftsoRegistry?: FtsoRegistryInstance,
  ftsoContracts?: AssetContracts[],
  contracts?: Contracts,
}

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

export function spewNewContractInfo(contracts: Contracts, addressUpdaterContracts: string[] | null, name: string, contractName: string, address: string, quiet = false, pascal = true) {
  if (!quiet) {
    console.error(`${name} contract: `, address);
  }
  if (pascal) {
    contracts.add(new Contract(pascalCase(name), contractName, address));
  }
  else {
    contracts.add(new Contract(name.replace(/\s/g, ""), contractName, address));
  }
  if (addressUpdaterContracts) {
    addressUpdaterContracts.push(name);
  }
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
 export async function waitFinalize3(hre: HardhatRuntimeEnvironment, address: string, func: () => any) {
  const web3 = hre.web3;
  let nonce = await web3.eth.getTransactionCount(address);
  let res = await func();
  while ((await web3.eth.getTransactionCount(address)) == nonce) {
    await new Promise((resolve: any) => { setTimeout(() => { resolve() }, 1000) })
    // console.log("Waiting...")
  }
  return res;
}

export interface IISetVpContract {
  address: string;
  setReadVpContract(_vpContract: string, txDetails?: any): Promise<any>;
  setWriteVpContract(_vpContract: string, txDetails?: any): Promise<any>;
  vpContractInitialized(): Promise<boolean>;
}

export async function setDefaultVPContract(hre: HardhatRuntimeEnvironment, token: IISetVpContract, governance: string) {
  const artifacts = hre.artifacts;
  const VPContractContract = artifacts.require("VPContract");
  const replacement = await token.vpContractInitialized();
  const vpContract = await VPContractContract.new(token.address, replacement);
  await token.setWriteVpContract(vpContract.address, { from: governance });
  await token.setReadVpContract(vpContract.address, { from: governance });
}

export function ftsoContractForSymbol(contracts: DeployedFlareContracts, symbol: string) {
  return contracts.ftsoContracts!.find(x => x.assetSymbol === symbol)
}


export function rewrapXassetParams(data: any): AssetDefinition {
  return {
    name: data.xAssetName,
    symbol: data.assetSymbol,
    wSymbol: data.xAssetSymbol,
    decimals: data.assetDecimals,
    ftsoDecimals: data.ftsoDecimals,
    maxMintRequestTwei: data.dummyAssetMinterMax,
    initialPriceUSDDec5: data.initialPriceUSDDec5
  }
}

export async function deployNewAsset(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  deployerAccountAddress: string,
  ftsoManager: FtsoManagerInstance,
  priceSubmitterAddress: string,
  wnatAddress: string,
  cleanupBlockNumberManager: CleanupBlockNumberManagerInstance,
  startTs: any,
  priceEpochDurationSeconds: number,
  revealEpochDurationSeconds: number,
  xAssetDefinition: AssetDefinition,
  priceDeviationThresholdBIPS: number,
  priceEpochCyclicBufferSize: number,
  minimalFtsoRandom: number,
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

  const artifacts = hre.artifacts;
  const DummyAssetMinter: DummyAssetMinterContract = artifacts.require("DummyAssetMinter");
  const AssetToken: AssetTokenContract = artifacts.require("AssetToken");
  const Ftso: FtsoContract = artifacts.require("Ftso");

  // Register an FTSO for the new Asset
  const ftso = await Ftso.new(xAssetDefinition.symbol, xAssetDefinition.ftsoDecimals, priceSubmitterAddress, wnatAddress, ftsoManager.address, startTs, priceEpochDurationSeconds,
    revealEpochDurationSeconds,xAssetDefinition.initialPriceUSDDec5, priceDeviationThresholdBIPS, priceEpochCyclicBufferSize, minimalFtsoRandom);
  spewNewContractInfo(contracts, null, `FTSO ${xAssetDefinition.symbol}`, `Ftso.sol`, ftso.address, quiet);

  // Deploy Asset if we are not deploying on real network
  if (deployDummyTokensAndMinters) {
    const xAssetToken = await AssetToken.new(deployerAccountAddress, xAssetDefinition.name, xAssetDefinition.wSymbol, xAssetDefinition.decimals);
    await setDefaultVPContract(hre, xAssetToken, deployerAccountAddress);
    spewNewContractInfo(contracts, null, xAssetDefinition.wSymbol, `AssetToken.sol`, xAssetToken.address, quiet, false);

    await cleanupBlockNumberManager.registerToken(xAssetToken.address);
    await xAssetToken.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);

    // Deploy dummy Asset minter
    const dummyAssetMinter = await DummyAssetMinter.new(xAssetToken.address, xAssetDefinition.maxMintRequestTwei);
    spewNewContractInfo(contracts, null, `Dummy ${xAssetDefinition.wSymbol} minter`, `DummyAssetMinter.sol`, dummyAssetMinter.address, quiet, false);


    // Establish governance over Asset by minter !!!
    await xAssetToken.proposeGovernance(dummyAssetMinter.address, { from: deployerAccountAddress });
    await dummyAssetMinter.claimGovernanceOverMintableToken();

    await ftsoManager.setFtsoAsset(ftso.address, xAssetToken.address);

    return { xAssetToken, dummyAssetMinter, ftso };
  }

  return { ftso }
}

export function capitalizeFirstLetter(st: string) {
  return st.charAt(0).toUpperCase() + st.slice(1).toLocaleLowerCase();
}

export async function findAssetFtso(contracts: Contracts, address: string): Promise<boolean> {
  const Ftso = artifacts.require("Ftso");
  const ftsoWnat = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
  let xAssetFtso = await ftsoWnat.assetFtsos(0);
  let i = 1;
  while (xAssetFtso != "") {
    if (xAssetFtso == address) {
      return true;
    } else {
      try {
        xAssetFtso = await ftsoWnat.assetFtsos(i++);
      } catch (e) {
        xAssetFtso = "";
      }
    }
  }
  return false;
}

export async function findFtso(ftsoManager: FtsoManagerInstance, address: string): Promise<boolean> {
  let ftsos = await ftsoManager.getFtsos();
  let found = false;
  ftsos.forEach((ftso) => {
    if (ftso == address) found = true;
  });
  return found;
}
