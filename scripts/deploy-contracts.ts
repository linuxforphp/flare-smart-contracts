/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */
import { 
  DummyFAssetMinterInstance, 
  FAssetTokenInstance,
  FlareKeeperInstance,
  FtsoInstance,
  FtsoManagerInstance} from "../typechain-truffle";
import { Contract, Contracts } from "./Contracts";
import { pascalCase } from "pascal-case";
import { FlareNetworkChartOfAccounts } from "../test/utils/Accounting"

// import { serializedParameters } from "./DeploymentParameters";

const BN = web3.utils.toBN;
const { constants, time } = require('@openzeppelin/test-helpers');

// const parameters = JSON.parse(serializedParameters);
const parameters = require(`./chain-config/${ process.env.CHAIN_CONFIG }.json`)

async function main(parameters: any) {
  // Define repository for created contracts
  const contracts = new Contracts();

  // Define accounts in play for the deployment process
  const deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  const governanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);
  const genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.genesisGovernancePrivateKey);

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const InflationAllocation = artifacts.require("InflationAllocation");
  const FlareKeeper = artifacts.require("FlareKeeper");
  const FlareNetworkGeneralLedger = artifacts.require("FlareNetworkGeneralLedger");
  const Ftso = artifacts.require("Ftso");
  const FtsoManager = artifacts.require("FtsoManager");
  const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting");
  const FtsoInflationAuthorizer = artifacts.require("FtsoInflationAuthorizer");
  const FtsoInflationPercentageProvider = artifacts.require("FtsoInflationPercentageProvider");
  const FtsoRewardManagerAccounting = artifacts.require("FtsoRewardManagerAccounting");
  const FtsoRewardManagerTopup = artifacts.require("FtsoRewardManagerTopup");
  const FtsoRewardMintingFaucet = artifacts.require("FtsoRewardMintingFaucet");
  const MintAccounting = artifacts.require("MintAccounting");
  const FtsoRewardManager = artifacts.require("FtsoRewardManager");
  const SupplyAccounting = artifacts.require("SupplyAccounting");
  const PriceSubmitter = artifacts.require("PriceSubmitter");
  const WFLR = artifacts.require("WFlr");
  const CloseManager = artifacts.require("CloseManager");

  // CloseManager contract
  const closeManager = await CloseManager.new(deployerAccount.address);
  spewNewContractInfo(contracts, CloseManager.contractName, closeManager.address);

  // Constitution contract
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address);
  spewNewContractInfo(contracts, InflationAllocation.contractName, inflationAllocation.address);

  // FtsoInflationPercentageProvider contract
  const ftsoInflationPercentageProvider = await FtsoInflationPercentageProvider.new(inflationAllocation.address);
  spewNewContractInfo(contracts, FtsoInflationPercentageProvider.contractName, ftsoInflationPercentageProvider.address);

  // FlareNetworkGeneralLedger contract
  const gl = await FlareNetworkGeneralLedger.new(deployerAccount.address);
  spewNewContractInfo(contracts, FlareNetworkGeneralLedger.contractName, gl.address);
  await gl.grantRole(await gl.POSTER_ROLE(), deployerAccount.address);

  // Add initial FLR supply to general ledger
  const journalEntries = [];
  journalEntries[0] = { accountName: FlareNetworkChartOfAccounts.GENESIS, debit: web3.utils.toWei(BN(parameters.totalFlrSupply)).toString(), credit: 0};
  journalEntries[1] = { accountName: FlareNetworkChartOfAccounts.GENESIS_TOKEN, debit: 0, credit: web3.utils.toWei(BN(parameters.totalFlrSupply)).toString()};
  await gl.post(journalEntries);

  // SupplyAccounting contract
  const supplyAccounting = await SupplyAccounting.new(gl.address);
  await gl.grantRole(await gl.POSTER_ROLE(), supplyAccounting.address);
  spewNewContractInfo(contracts, SupplyAccounting.contractName, supplyAccounting.address);

  // FtsoInflationAccounting contract
  const ftsoInflationAccounting = await FtsoInflationAccounting.new(deployerAccount.address, gl.address);
  await gl.grantRole(await gl.POSTER_ROLE(), ftsoInflationAccounting.address);
  spewNewContractInfo(contracts, FtsoInflationAccounting.contractName, ftsoInflationAccounting.address);

  // FtsoRewardManagerAccounting contract
  const ftsoRewardManagerAccounting = await FtsoRewardManagerAccounting.new(deployerAccount.address, gl.address);
  await gl.grantRole(await gl.POSTER_ROLE(), ftsoRewardManagerAccounting.address);
  spewNewContractInfo(contracts, FtsoRewardManagerAccounting.contractName, ftsoRewardManagerAccounting.address);

  // MintAccounting contract
  const mintAccounting = await MintAccounting.new(deployerAccount.address, gl.address);
  await gl.grantRole(await gl.POSTER_ROLE(), mintAccounting.address);
  spewNewContractInfo(contracts, MintAccounting.contractName, mintAccounting.address);

  // FtsoInflationAuthorizer contract
  const ftsoInflationAuthorizer = await FtsoInflationAuthorizer.new(deployerAccount.address, 
    parameters.ftsoInflationAuthorizationRequestFrequencySec,
    0,
    ftsoInflationPercentageProvider.address,
    supplyAccounting.address,
    closeManager.address,
    ftsoInflationAccounting.address);
  await ftsoInflationAccounting.grantRole(await ftsoInflationAccounting.POSTER_ROLE(), ftsoInflationAuthorizer.address);
  spewNewContractInfo(contracts, FtsoInflationAuthorizer.contractName, ftsoInflationAuthorizer.address);
  await closeManager.registerToClose(ftsoInflationAuthorizer.address);

  // RewardManager contract
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    ftsoRewardManagerAccounting.address,
    supplyAccounting.address,
    parameters.rewardFeePercentageUpdateOffset,
    parameters.defaultRewardFeePercentage,
    parameters.rewardExpiryOffset,
    closeManager.address);
  await ftsoRewardManagerAccounting.grantRole(await ftsoRewardManagerAccounting.POSTER_ROLE(), ftsoRewardManager.address);
  spewNewContractInfo(contracts, FtsoRewardManager.contractName, ftsoRewardManager.address);
  await closeManager.registerToClose(ftsoRewardManager.address);

  // FtsoRewardManagerTopup contract
  const ftsoRewardManagerTopup = await FtsoRewardManagerTopup.new(
    ftsoRewardManager.address, 
    ftsoInflationAccounting.address,
    ftsoInflationAuthorizer.address);
  spewNewContractInfo(contracts, FtsoRewardManagerTopup.contractName, ftsoRewardManagerTopup.address);

  // PriceSubmitter contract
  const priceSubmitter = await PriceSubmitter.new();
  spewNewContractInfo(contracts, PriceSubmitter.contractName, priceSubmitter.address);

  // FtsoManager contract
  // Get the timestamp for the just mined block
  const startTs = await time.latest();
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    ftsoRewardManager.address,
    priceSubmitter.address,
    ftsoInflationAuthorizer.address,
    parameters.priceEpochDurationSec,
    startTs,
    parameters.revealEpochDurationSec,
    parameters.rewardEpochDurationSec,
    startTs,
    parameters.votePowerBoundaryFraction);
  spewNewContractInfo(contracts, FtsoManager.contractName, ftsoManager.address);

  // Tell reward manager about ftso manager
  await ftsoRewardManager.setFTSOManager(ftsoManager.address);

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
  } catch(e) {
    // keeper might be already initialized if redeploy
    // NOTE: unregister must claim governance of flareKeeper!
    currentGovernanceAddress = governanceAccount.address
  }
  await flareKeeper.proposeGovernance(deployerAccount.address, { from: currentGovernanceAddress });
  await flareKeeper.claimGovernance({ from: deployerAccount.address });
  await flareKeeper.setMintAccounting(mintAccounting.address);
  await mintAccounting.grantRole(await mintAccounting.POSTER_ROLE(), flareKeeper.address);

  // FtsoRewardMintingFaucet contract
  const ftsoRewardMintingFaucet = await FtsoRewardMintingFaucet.new(
    deployerAccount.address, 
    ftsoRewardManagerTopup.address,
    ftsoRewardManager.address,
    flareKeeper.address,
    parameters.ftsoRewardMintingFaucetFundWithdrawTimeLockSec,
    parameters.ftsoRewardMintingFundRequestIntervalSec,
    mintAccounting.address,
    ftsoInflationAccounting.address);
  spewNewContractInfo(contracts, FtsoRewardMintingFaucet.contractName, ftsoRewardMintingFaucet.address);
  await mintAccounting.grantRole(await mintAccounting.POSTER_ROLE(), ftsoRewardMintingFaucet.address);
  await ftsoInflationAccounting.grantRole(await ftsoInflationAccounting.POSTER_ROLE(), ftsoRewardMintingFaucet.address);
  await flareKeeper.grantRole(
    await flareKeeper.MINTER_ROLE(), 
    ftsoRewardMintingFaucet.address, 
    {from: genesisGovernanceAccount.address});

  // Register kept contracts to the keeper
  await flareKeeper.registerToKeep(ftsoInflationAuthorizer.address);
  await flareKeeper.registerToKeep(ftsoRewardMintingFaucet.address);
  await flareKeeper.registerToKeep(ftsoManager.address);

  // Tell reward manager about flareKeeper address
  await ftsoRewardManager.setFlareKeeper(flareKeeper.address);
  
  // Deploy wrapped FLR
  const wflr = await WFLR.new();
  spewNewContractInfo(contracts, WFLR.contractName, wflr.address);
  await ftsoRewardManager.setWFLR(wflr.address);

  // Create a non-FAsset FTSO
  // Register an FTSO for WFLR
  const ftsoWflr = await Ftso.new("WFLR", wflr.address, ftsoManager.address, parameters.initialWflrPrice);
  spewNewContractInfo(contracts, `FTSO WFLR`, ftsoWflr.address);

  // Deploy FAsset, minter, and ftso for XRP
  console.error("Rigging XRP...");
  const [, , ftsoFxrp] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    wflr.address,
    parameters.XRP.fAssetName,
    parameters.XRP.fAssetSymbol,
    parameters.XRP.fAssetDecimals,
    parameters.XRP.dummyFAssetMinterMax,
    parameters.XRP.initialPrice);

  // Deploy FAsset, minter, and ftso for LTC
  console.error("Rigging LTC...");
  const [, , ftsoFltc] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    wflr.address,
    parameters.LTC.fAssetName,
    parameters.LTC.fAssetSymbol,
    parameters.LTC.fAssetDecimals,
    parameters.LTC.dummyFAssetMinterMax,
    parameters.LTC.initialPrice);

  // Deploy FAsset, minter, and ftso for XDG
  console.error("Rigging XDG...");
  const [, , ftsoFxdg] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    wflr.address,
    parameters.XDG.fAssetName,
    parameters.XDG.fAssetSymbol,
    parameters.XDG.fAssetDecimals,
    parameters.XDG.dummyFAssetMinterMax,
    parameters.XDG.initialPrice);

  // Deploy FAsset, minter, and ftso for ADA
  console.error("Rigging ADA...");
  const [, , ftsoFada] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    wflr.address,
    parameters.ADA.fAssetName,
    parameters.ADA.fAssetSymbol,
    parameters.ADA.fAssetDecimals,
    parameters.ADA.dummyFAssetMinterMax,
    parameters.ADA.initialPrice);

  // Deploy FAsset, minter, and ftso for ALGO
  console.error("Rigging ALGO...");
  const [, , ftsoFalgo] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    wflr.address,
    parameters.ALGO.fAssetName,
    parameters.ALGO.fAssetSymbol,
    parameters.ALGO.fAssetDecimals,
    parameters.ALGO.dummyFAssetMinterMax,
    parameters.ALGO.initialPrice);

  // Deploy FAsset, minter, and ftso for BCH
  console.error("Rigging BCH...");
  const [, , ftsoFbch] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    wflr.address,
    parameters.BCH.fAssetName,
    parameters.BCH.fAssetSymbol,
    parameters.BCH.fAssetDecimals,
    parameters.BCH.dummyFAssetMinterMax,
    parameters.BCH.initialPrice);

  // Deploy FAsset, minter, and ftso for DGB
  console.error("Rigging DGB...");
  const [, , ftsoFdgb] = await deployNewFAsset(
    contracts,
    deployerAccount.address,
    ftsoManager,
    wflr.address,
    parameters.DGB.fAssetName,
    parameters.DGB.fAssetSymbol,
    parameters.DGB.fAssetDecimals,
    parameters.DGB.dummyFAssetMinterMax,
    parameters.DGB.initialPrice);

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

  // Turn over governance
  // TODO: Lots more governance turnover
  console.error("Transfering governance...");
  await closeManager.proposeGovernance(governanceAccount.address);
  await inflationAllocation.proposeGovernance(governanceAccount.address);
  await gl.grantRole(await gl.DEFAULT_ADMIN_ROLE(), governanceAccount.address);
  await gl.renounceRole(await gl.DEFAULT_ADMIN_ROLE(), deployerAccount.address);
  await ftsoInflationAccounting.grantRole(await ftsoInflationAccounting.DEFAULT_ADMIN_ROLE(), governanceAccount.address);
  await ftsoInflationAccounting.renounceRole(await ftsoInflationAccounting.DEFAULT_ADMIN_ROLE(), deployerAccount.address);
  await ftsoRewardManagerAccounting.grantRole(await ftsoRewardManagerAccounting.DEFAULT_ADMIN_ROLE(), governanceAccount.address);
  await ftsoRewardManagerAccounting.renounceRole(await ftsoRewardManagerAccounting.DEFAULT_ADMIN_ROLE(), deployerAccount.address);
  await mintAccounting.grantRole(await mintAccounting.DEFAULT_ADMIN_ROLE(), governanceAccount.address);
  await mintAccounting.renounceRole(await mintAccounting.DEFAULT_ADMIN_ROLE(), deployerAccount.address);
  await ftsoInflationAuthorizer.proposeGovernance(governanceAccount.address);
  await ftsoRewardMintingFaucet.proposeGovernance(governanceAccount.address);
  await flareKeeper.proposeGovernance(governanceAccount.address);
  await ftsoRewardManager.proposeGovernance(governanceAccount.address);
  await ftsoManager.proposeGovernance(governanceAccount.address);
  await ftsoInflationAuthorizer.proposeGovernance(governanceAccount.address);

  console.error("Contracts in JSON:");

  console.log(contracts.serialize());

  console.error("Deploy complete.");
}

async function deployNewFAsset(
  contracts: Contracts,
  deployerAccountAddress: string,
  ftsoManager: FtsoManagerInstance,
  wflrAddress: string,
  name: string,
  symbol: string,
  decimals: number,
  maxMintRequestTwei: number,
  initialPrice: number):
  Promise<[fAssetToken: FAssetTokenInstance,
    dummyFAssetMinter: DummyFAssetMinterInstance,
    ftso: FtsoInstance]> {

  const DummyFAssetMinter = artifacts.require("DummyFAssetMinter");
  const FAssetToken = artifacts.require("FAssetToken");
  const Ftso = artifacts.require("Ftso");

  // Deploy FAsset
  const fAssetToken = await FAssetToken.new(deployerAccountAddress, name, symbol, decimals);
  spewNewContractInfo(contracts, symbol, fAssetToken.address);

  // Deploy dummy FAsset minter
  const dummyFAssetMinter = await DummyFAssetMinter.new(fAssetToken.address, maxMintRequestTwei);
  spewNewContractInfo(contracts, `Dummy ${ symbol } minter`, dummyFAssetMinter.address);

  // Establish governance over FAsset by minter
  await fAssetToken.proposeGovernance(dummyFAssetMinter.address, { from: deployerAccountAddress });
  await dummyFAssetMinter.claimGovernanceOverMintableToken();

  // Register an FTSO for the new FAsset
  const ftso = await Ftso.new(symbol, wflrAddress, ftsoManager.address, initialPrice);
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
