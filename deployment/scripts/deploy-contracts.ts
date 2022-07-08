/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import {
  AddressUpdaterContract, CleanupBlockNumberManagerContract, DelegationAccountClonableContract, DelegationAccountManagerContract,
  DelegationAccountManagerInstance, DistributionContract, DistributionToDelegatorsContract, DistributionToDelegatorsInstance,
  DistributionTreasuryContract, DistributionTreasuryInstance, FlareDaemonContract, FlareDaemonInstance, FtsoContract,
  FtsoInstance, FtsoManagementContract, FtsoManagerContract, FtsoRegistryContract, FtsoRewardManagerContract, GovernanceSettingsContract,
  GovernanceVotePowerContract, IncentivePoolAllocationContract, IncentivePoolContract, IncentivePoolTreasuryContract,
  IncentivePoolTreasuryInstance, InflationAllocationContract, InflationContract, InitialAirdropContract, InitialAirdropInstance,
  PriceSubmitterContract, PriceSubmitterInstance, StateConnectorContract, StateConnectorInstance, SuicidalMockContract, SupplyContract,
  TeamEscrowContract, TestableFlareDaemonContract, VoterWhitelisterContract, WNatContract
} from '../../typechain-truffle';
import { Contracts } from "./Contracts";
import {
  AssetContracts, DeployedFlareContracts, deployNewAsset, rewrapXassetParams, setDefaultVPContract, spewNewContractInfo,
  verifyParameters, waitFinalize3
} from './deploy-utils';


export async function deployContracts(hre: HardhatRuntimeEnvironment, parameters: any, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;

  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
  // Define address updater contracts names list
  const addressUpdaterContracts: string[] = [];
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
  if (genesisGovernanceBalance == '0') {
    console.error("Sending 2 NAT to genesis governance account ...");
    const toTransfer = web3.utils.toWei("210")
    await waitFinalize3(hre, deployerAccount.address, () => web3.eth.sendTransaction({ from: deployerAccount.address, to: genesisGovernanceAccount.address, value: toTransfer }));
  }
  genesisGovernanceBalance = await web3.eth.getBalance(genesisGovernanceAccount.address);
  if (genesisGovernanceBalance == '0') {
    throw Error("Genesis governance account still empty.")
  }
  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const GovernanceSettings: GovernanceSettingsContract = artifacts.require("GovernanceSettings");
  const AddressUpdater: AddressUpdaterContract = artifacts.require("AddressUpdater");
  const InflationAllocation: InflationAllocationContract = artifacts.require("InflationAllocation");
  const StateConnector: StateConnectorContract = artifacts.require("StateConnector");
  const FlareDaemon: FlareDaemonContract = artifacts.require("FlareDaemon");
  const TestableFlareDaemon: TestableFlareDaemonContract = artifacts.require("TestableFlareDaemon");
  const Ftso: FtsoContract = artifacts.require("Ftso");
  const FtsoManager: FtsoManagerContract = artifacts.require("FtsoManager");
  const FtsoManagement: FtsoManagementContract = artifacts.require("FtsoManagement");
  const Inflation: InflationContract = artifacts.require("Inflation");
  const FtsoRegistry: FtsoRegistryContract = artifacts.require("FtsoRegistry");
  const FtsoRewardManager: FtsoRewardManagerContract = artifacts.require("FtsoRewardManager");
  const DataProviderFee = artifacts.require("DataProviderFee");
  const CleanupBlockNumberManager: CleanupBlockNumberManagerContract = artifacts.require("CleanupBlockNumberManager");
  const PriceSubmitter: PriceSubmitterContract = artifacts.require("PriceSubmitter");
  const Supply: SupplyContract = artifacts.require("Supply");
  const VoterWhitelister: VoterWhitelisterContract = artifacts.require("VoterWhitelister");
  const WNat: WNatContract = artifacts.require("WNat");
  const DistributionTreasury: DistributionTreasuryContract = artifacts.require("DistributionTreasury");
  const Distribution: DistributionContract = artifacts.require("Distribution");
  const DistributionToDelegators: DistributionToDelegatorsContract = artifacts.require("DistributionToDelegators");
  const IncentivePoolTreasury: IncentivePoolTreasuryContract = artifacts.require("IncentivePoolTreasury");
  const IncentivePool: IncentivePoolContract = artifacts.require("IncentivePool");
  const IncentivePoolAllocation: IncentivePoolAllocationContract = artifacts.require("IncentivePoolAllocation");
  const InitialAirdrop: InitialAirdropContract = artifacts.require("InitialAirdrop");
  const TeamEscrow: TeamEscrowContract = artifacts.require("TeamEscrow");
  const GovernanceVotePower: GovernanceVotePowerContract = artifacts.require("GovernanceVotePower");
  const DelegationAccountClonable: DelegationAccountClonableContract = artifacts.require("DelegationAccountClonable");
  const DelegationAccountManager: DelegationAccountManagerContract = artifacts.require("DelegationAccountManager");
  const SuicidalMock: SuicidalMockContract = artifacts.require("SuicidalMock");

  // Initialize the state connector
  let stateConnector: StateConnectorInstance;
  try {
    stateConnector = await StateConnector.at(parameters.stateConnectorAddress);
  } catch (e) {
    if (!quiet) {
      console.error("StateConnector not in genesis...creating new.")
    }
    stateConnector = await StateConnector.new();
  }
  spewNewContractInfo(contracts, addressUpdaterContracts, StateConnector.contractName, `StateConnector.sol`, stateConnector.address, quiet);

  // Initialize the daemon
  let flareDaemon: FlareDaemonInstance;
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
  spewNewContractInfo(contracts, addressUpdaterContracts, FlareDaemon.contractName, `FlareDaemon.sol`, flareDaemon.address, quiet);

  try {
    await flareDaemon.initialiseFixedAddress();
  } catch (e) {
    console.error(`flareDaemon.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  let genesisGovernance = await flareDaemon.governance()

  // Unregister whatever is registered with verification
  try {
    console.error("Unregistring contracts");
    try {
      await waitFinalize3(hre, genesisGovernance, () => flareDaemon.registerToDaemonize([], { from: genesisGovernance }));
    } catch (ee) {
      console.error("Error while unregistring. ", ee)
    }
  } catch (e) {
    console.error("No more kept contracts")
  }

  // Set the block holdoff should a kept contract exceeded its max gas allocation
  await flareDaemon.setBlockHoldoff(parameters.flareDaemonGasExceededHoldoffBlocks, { from: genesisGovernance });

  // PriceSubmitter contract
  let priceSubmitter: PriceSubmitterInstance;
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
    console.error(`priceSubmitter.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  spewNewContractInfo(contracts, addressUpdaterContracts, PriceSubmitter.contractName, "PriceSubmitter.sol", priceSubmitter.address, quiet);

  const distributionTotalEntitlementWei = BN(parameters.distributionTotalEntitlementWei.replace(/\s/g, ''));
  // Initialize the distribution treasury
  let distributionTreasury: DistributionTreasuryInstance;
  try {
    distributionTreasury = await DistributionTreasury.at(parameters.distributionTreasuryAddress);
  } catch (e) {
    if (!quiet) {
      console.error("DistributionTreasury not in genesis...creating new and sending funds.")
    }
    distributionTreasury = await DistributionTreasury.new();
    const suicidalMock = await SuicidalMock.new(distributionTreasury.address);
    await web3.eth.sendTransaction({ to: suicidalMock.address, value: distributionTotalEntitlementWei });
    await suicidalMock.die();
  }
  // This has to be done always
  try {
    await distributionTreasury.initialiseFixedAddress();
  } catch (e) {
    console.error(`distributionTreasury.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  spewNewContractInfo(contracts, addressUpdaterContracts, DistributionTreasury.contractName, `DistributionTreasury.sol`, distributionTreasury.address, quiet);

  // Initialize the incentive pool treasury
  let incentivePoolTreasury: IncentivePoolTreasuryInstance;
  try {
    incentivePoolTreasury = await IncentivePoolTreasury.at(parameters.incentivePoolTreasuryAddress);
  } catch (e) {
    if (!quiet) {
      console.error("IncentivePoolTreasury not in genesis...creating new and sending funds.")
    }
    const incentivePoolWei = BN(parameters.incentivePoolWei.replace(/\s/g, ''));
    incentivePoolTreasury = await IncentivePoolTreasury.new();
    const suicidalMock = await SuicidalMock.new(incentivePoolTreasury.address);
    await web3.eth.sendTransaction({ to: suicidalMock.address, value: incentivePoolWei });
    await suicidalMock.die();
  }
  // This has to be done always
  try {
    await incentivePoolTreasury.initialiseFixedAddress();
  } catch (e) {
    console.error(`incentivePoolTreasury.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  spewNewContractInfo(contracts, addressUpdaterContracts, IncentivePoolTreasury.contractName, `IncentivePoolTreasury.sol`, incentivePoolTreasury.address, quiet);

  // Initialize the initial airdrop contract
  let initialAirdrop: InitialAirdropInstance;
  try {
    initialAirdrop = await InitialAirdrop.at(parameters.initialAirdropAddress);
  } catch (e) {
    if (!quiet) {
      console.error("InitialAirdrop not in genesis...creating new and sending funds.")
    }
    const initialAirdropWei = BN(parameters.initialAirdropWei.replace(/\s/g, ''));
    initialAirdrop = await InitialAirdrop.new();
    const suicidalMock = await SuicidalMock.new(initialAirdrop.address);
    await web3.eth.sendTransaction({ to: suicidalMock.address, value: initialAirdropWei });
    await suicidalMock.die();
  }
  // This has to be done always
  try {
    await initialAirdrop.initialiseFixedAddress();
  } catch (e) {
    console.error(`initialAirdrop.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  spewNewContractInfo(contracts, addressUpdaterContracts, InitialAirdrop.contractName, `InitialAirdrop.sol`, initialAirdrop.address, quiet);
  await initialAirdrop.setLatestAirdropStart(parameters.initialAirdropLatestStart, { from: genesisGovernance });

  // GovernanceSettings (do not add it to AddressUpdater)
  // default executors are governancePublicKey and governanceExecutorPublicKey if set
  const executors = [parameters.governancePublicKey];
  if (parameters.governanceExecutorPublicKey != "<use .env: GOVERNANCE_EXECUTOR_PUBLIC_KEY>") {
    console.error(`Adding ${parameters.governanceExecutorPublicKey} as governance executor.`)
    executors.push(parameters.governanceExecutorPublicKey);
  }
  const governanceSettings = await GovernanceSettings.new(parameters.governancePublicKey,
    parameters.governanceTimelock, executors);
  spewNewContractInfo(contracts, null, GovernanceSettings.contractName, `GovernanceSettings.sol`, governanceSettings.address, quiet);

  // AddressUpdater
  const addressUpdater = await AddressUpdater.new(deployerAccount.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, AddressUpdater.contractName, `AddressUpdater.sol`, addressUpdater.address, quiet);

  // Tell genesis contracts about address updater
  await flareDaemon.setAddressUpdater(addressUpdater.address, { from: genesisGovernance });
  await priceSubmitter.setAddressUpdater(addressUpdater.address, { from: genesisGovernance });

  // InflationAllocation contract
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, addressUpdater.address, parameters.scheduledInflationPercentageBIPS);
  spewNewContractInfo(contracts, addressUpdaterContracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);

  let startTs = BN(parameters.systemStart);
  if (startTs.eqn(0)) {
    // Get the timestamp for the just mined block
    let currentBlock = await web3.eth.getBlock(await web3.eth.getBlockNumber());
    startTs = BN(currentBlock.timestamp);
    if (!quiet) {
      console.error(`Using current block timestamp ${currentBlock.timestamp} as system start timestamp.`);
    }
  } else {
    if (!quiet) {
      console.error(`Using systemStart parameter ${parameters.systemStart} as system start timestamp.`);
    }
  }

  // Delayed reward epoch start time
  const rewardEpochStartTs = startTs.addn(parameters.rewardEpochsStartDelayPriceEpochs * parameters.priceEpochDurationSeconds + parameters.revealEpochDurationSeconds);

  // Inflation contract
  const inflation = await Inflation.new(
    deployerAccount.address,
    flareDaemon.address,
    addressUpdater.address,
    startTs.addn(parameters.inflationStartDelaySeconds)
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);

  // Supply contract
  const supply = await Supply.new(
    deployerAccount.address,
    addressUpdater.address,
    BN(parameters.totalNativeSupplyNAT).mul(BN(10).pow(BN(18))),
    BN(parameters.totalExcludedSupplyNAT).mul(BN(10).pow(BN(18))),
    []
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, Supply.contractName, `Supply.sol`, supply.address, quiet);

  // FtsoRewardManager contract (must link first)
  FtsoRewardManager.link(await DataProviderFee.new());
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    addressUpdater.address,
    "0x0000000000000000000000000000000000000000", // old ftso reward manager
    parameters.rewardFeePercentageUpdateOffsetEpochs,
    parameters.defaultRewardFeePercentageBIPS);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRewardManager.contractName, `FtsoRewardManager.sol`, ftsoRewardManager.address, quiet);

  // CleanupBlockNumberManager contract
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.new(
    deployerAccount.address,
    addressUpdater.address,
    "FtsoManager"
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, CleanupBlockNumberManager.contractName, `CleanupBlockNumberManager.sol`, cleanupBlockNumberManager.address, quiet);

  // Team escrow contract
  const teamEscrow = await TeamEscrow.new(deployerAccount.address, addressUpdater.address, parameters.distributionLatestEntitlementStart);
  spewNewContractInfo(contracts, addressUpdaterContracts, TeamEscrow.contractName, `TeamEscrow.sol`, teamEscrow.address, quiet);

  // Inflation allocation needs to know about reward managers
  let receiversAddresses = []
  for (let a of parameters.inflationReceivers) {
    receiversAddresses.push(contracts.getContractAddress(a));
  }
  await inflationAllocation.setSharingPercentages(receiversAddresses, parameters.inflationSharingBIPS);

  // Supply contract needs to know about reward managers
  await supply.addTokenPool(ftsoRewardManager.address, 0);

  // setup topup factors on inflation receivers
  for (let i = 0; i < receiversAddresses.length; i++) {
    await inflation.setTopupConfiguration(receiversAddresses[i], parameters.inflationTopUpTypes[i], parameters.inflationTopUpFactorsx100[i])
  }

  // FtsoRegistryContract
  const ftsoRegistry = await FtsoRegistry.new(deployerAccount.address, addressUpdater.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRegistry.contractName, `FtsoRegistry.sol`, ftsoRegistry.address, quiet);

  // VoterWhitelisting
  const voterWhitelister = await VoterWhitelister.new(deployerAccount.address, addressUpdater.address, priceSubmitter.address, parameters.defaultVoterWhitelistSize);
  spewNewContractInfo(contracts, addressUpdaterContracts, VoterWhitelister.contractName, `VoterWhitelister.sol`, voterWhitelister.address, quiet);

  let delegationAccountManager: DelegationAccountManagerInstance;
  let distributionToDelegators: DistributionToDelegatorsInstance;
  if (parameters.deployDistributionContract) {
    // DelegationAccountManager
    delegationAccountManager = await DelegationAccountManager.new(deployerAccount.address, addressUpdater.address);
    spewNewContractInfo(contracts, addressUpdaterContracts, DelegationAccountManager.contractName, `DelegationAccountManager.sol`, delegationAccountManager.address, quiet);

    const delegationAccountClonable = await DelegationAccountClonable.new();
    spewNewContractInfo(contracts, null, DelegationAccountClonable.contractName, `DelegationAccountClonable.sol`, delegationAccountClonable.address, quiet);
    await delegationAccountClonable.initialize(delegationAccountManager.address, delegationAccountManager.address);
    await delegationAccountManager.setLibraryAddress(delegationAccountClonable.address);

    // Distribution contracts
    const distribution = await Distribution.new(deployerAccount.address, distributionTreasury.address, parameters.distributionLatestEntitlementStart);
    spewNewContractInfo(contracts, addressUpdaterContracts, Distribution.contractName, `Distribution.sol`, distribution.address, quiet);

    distributionToDelegators = await DistributionToDelegators.new(deployerAccount.address, addressUpdater.address, priceSubmitter.address, distributionTreasury.address, distributionTotalEntitlementWei, parameters.distributionLatestEntitlementStart);
    spewNewContractInfo(contracts, addressUpdaterContracts, DistributionToDelegators.contractName, `DistributionToDelegators.sol`, distributionToDelegators.address, quiet);

    await distributionTreasury.setContracts(distribution.address, distributionToDelegators.address, { from: genesisGovernance });
  }

  // IncentivePoolAllocation contract
  const incentivePoolAllocation = await IncentivePoolAllocation.new(deployerAccount.address, addressUpdater.address, [0]);
  spewNewContractInfo(contracts, addressUpdaterContracts, IncentivePoolAllocation.contractName, `IncentivePoolAllocation.sol`, incentivePoolAllocation.address, quiet);

  // IncentivePool contract
  const incentivePool = await IncentivePool.new(
    deployerAccount.address,
    flareDaemon.address,
    addressUpdater.address,
    incentivePoolTreasury.address,
    parameters.incentivePoolStart
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, IncentivePool.contractName, `IncentivePool.sol`, incentivePool.address, quiet);
  await incentivePoolTreasury.setIncentivePoolContract(incentivePool.address, { from: genesisGovernance });
  // Supply contract needs to know about token pool
  await supply.addTokenPool(incentivePool.address, 0);

  // Get the timestamp for the just mined block
  let currentBlock = await web3.eth.getBlock(await web3.eth.getBlockNumber());
  let ftsoStartTs = BN(currentBlock.timestamp);
  if (ftsoStartTs.lt(startTs)) {
    ftsoStartTs = ftsoStartTs.subn(parameters.priceEpochDurationSeconds).addn(startTs.sub(ftsoStartTs).modn(parameters.priceEpochDurationSeconds));
  } else {
    ftsoStartTs = startTs;
  }

  // FtsoManager contract (must link with library first)
  FtsoManager.link(await FtsoManagement.new() as any)
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareDaemon.address,
    addressUpdater.address,
    priceSubmitter.address,
    "0x0000000000000000000000000000000000000000", // old ftso manager
    ftsoStartTs,
    parameters.priceEpochDurationSeconds,
    parameters.revealEpochDurationSeconds,
    rewardEpochStartTs,
    parameters.rewardEpochDurationSeconds,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  // Deploy wrapped native token
  const wNat = await WNat.new(deployerAccount.address, parameters.wrappedNativeName, parameters.wrappedNativeSymbol);
  spewNewContractInfo(contracts, addressUpdaterContracts, WNat.contractName, `WNat.sol`, wNat.address, quiet);

  await setDefaultVPContract(hre, wNat, deployerAccount.address);
  await cleanupBlockNumberManager.registerToken(wNat.address);
  await wNat.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);

  // Deploy governance vote power
  const governanceVotePower = await GovernanceVotePower.new(wNat.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, GovernanceVotePower.contractName, `GovernanceVotePower.sol`, governanceVotePower.address, quiet);

  // Tell wNat contract about governance vote power
  await wNat.setGovernanceVotePower(governanceVotePower.address);

  // Tell address updater about all contracts
  await addressUpdater.addOrUpdateContractNamesAndAddresses(
    addressUpdaterContracts, addressUpdaterContracts.map(name => contracts.getContractAddress(name))
  );

  // Set other contracts on all address updatable contracts
  let addressUpdatableContracts = [
    flareDaemon.address,
    inflationAllocation.address,
    inflation.address,
    ftsoRegistry.address,
    cleanupBlockNumberManager.address,
    voterWhitelister.address,
    priceSubmitter.address,
    ftsoManager.address,
    ftsoRewardManager.address,
    supply.address,
    incentivePoolAllocation.address,
    incentivePool.address,
    teamEscrow.address
  ];
  if (parameters.deployDistributionContract) {
    addressUpdatableContracts.push(delegationAccountManager!.address);
    addressUpdatableContracts.push(distributionToDelegators!.address);
  }
  await addressUpdater.updateContractAddresses(addressUpdatableContracts);

  let assetToContracts = new Map<string, AssetContracts>();

  // Create a FTSO for WNAT
  let ftsoWnat: FtsoInstance;
  if (parameters.deployNATFtso) {
    ftsoWnat = await Ftso.new(parameters.nativeSymbol, parameters.nativeFtsoDecimals, priceSubmitter.address, wNat.address, ftsoManager.address, ftsoStartTs, parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
    spewNewContractInfo(contracts, null, `FTSO WNAT`, `Ftso.sol`, ftsoWnat.address, quiet);

    assetToContracts.set(parameters.nativeSymbol, {
      xAssetToken: wNat,
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
      wNat.address,
      cleanupBlockNumberManager,
      ftsoStartTs,
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
    ...(parameters.deployNATFtso ? [{ assetSymbol: parameters.nativeSymbol }] : []),
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
    await ftsoManager.setFtsoAssetFtsos(ftsoWnat!.address, multiAssetFtsos);
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
    supply: supply,
    inflationAllocation: inflationAllocation,
    stateConnector: stateConnector,
    ftsoRegistry: ftsoRegistry,
    ftsoContracts: [
      ...(parameters.deployNATFtso ? [{ xAssetSymbol: 'WNAT' }] : []),
      ...parameters.assets
    ].map(asset => assetToContracts.get(asset.xAssetSymbol)),
    contracts: contracts,
  } as DeployedFlareContracts;
}
