import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../deployment/scripts/Contracts';
import { ValidatorRegistryInstance, VoterWhitelisterInstance } from "../../../typechain-truffle";
import { FLARE_DAEMON_ADDRESS, GOVERNANCE_GENESIS_ADDRESS, PRICE_SUBMITTER_ADDRESS } from '../../utils/constants';
import { encodeContractNames } from '../../utils/test-helpers';

const FlareDaemon = artifacts.require("FlareDaemon");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const ValidatorRegistry = artifacts.require("ValidatorRegistry");
const FtsoManager = artifacts.require("FtsoManager");
const VoterWhitelister = artifacts.require("VoterWhitelister");
const Ftso = artifacts.require("Ftso");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const MockContract = artifacts.require("MockContract");

const getTestFile = require('../../utils/constants').getTestFile;

let validatorRegistry: ValidatorRegistryInstance;

contract(`ValidatorRegistry.sol; ${getTestFile(__filename)}; ValidatorRegistry system tests`, async accounts => {
  const ADDRESS_UPDATER = accounts[16];

  let voterWhitelister: VoterWhitelisterInstance;
  
  before(async () => {
    const startTs = await time.latest();

    const flareDaemon = await FlareDaemon.at(FLARE_DAEMON_ADDRESS);
    const priceSubmitter = await PriceSubmitter.at(PRICE_SUBMITTER_ADDRESS);
    voterWhitelister = await VoterWhitelister.new(GOVERNANCE_GENESIS_ADDRESS, ADDRESS_UPDATER, priceSubmitter.address, 100);
    const ftsoRegistry = await FtsoRegistry.new(GOVERNANCE_GENESIS_ADDRESS, ADDRESS_UPDATER);
    const ftsoManager = await FtsoManager.new(GOVERNANCE_GENESIS_ADDRESS, flareDaemon.address, ADDRESS_UPDATER, priceSubmitter.address, constants.ZERO_ADDRESS, startTs, 60, 5, startTs.addn(5), 600, 4);
    const inflationMock = await MockContract.new();
    const rewardManagerMock = await MockContract.new();
    const supplyMock = await MockContract.new();
    const cleanupBlockNumberManagerMock = await MockContract.new();
    const wNatMock = await MockContract.new();

    // Make sure daemon is initialized with a governance address...if may revert if already done.
    try {
      await flareDaemon.initialiseFixedAddress();
    } catch (e) {
      const governanceAddress = await flareDaemon.governance();
      if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
        throw e;
      }
      // keep going
    }
    
    try {
      await priceSubmitter.initialiseFixedAddress();
    } catch (e) {
      const governanceAddress = await priceSubmitter.governance();
      if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
        throw e;
      }
      // keep going
    }

    await flareDaemon.unregisterAll({ from: GOVERNANCE_GENESIS_ADDRESS });
    await flareDaemon.setAddressUpdater(ADDRESS_UPDATER, { from: GOVERNANCE_GENESIS_ADDRESS });
    await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, {from: GOVERNANCE_GENESIS_ADDRESS});

    await ftsoManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
      [ADDRESS_UPDATER, rewardManagerMock.address, ftsoRegistry.address, voterWhitelister.address, supplyMock.address, cleanupBlockNumberManagerMock.address], {from: ADDRESS_UPDATER});
    await ftsoRegistry.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, ftsoManager.address], {from: ADDRESS_UPDATER});
    await voterWhitelister.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, ftsoRegistry.address, ftsoManager.address], {from: ADDRESS_UPDATER});
    await flareDaemon.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
      [ADDRESS_UPDATER, inflationMock.address], {from: ADDRESS_UPDATER});
    await priceSubmitter.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, ftsoRegistry.address, voterWhitelister.address, ftsoManager.address], {from: ADDRESS_UPDATER});
        
    await ftsoManager.setGovernanceParameters(10, 10, 500, 100000, 5000, 300, 50000, [], {from: GOVERNANCE_GENESIS_ADDRESS});
    await flareDaemon.registerToDaemonize([{daemonizedContract: ftsoManager.address, gasLimit: 0}], {from: GOVERNANCE_GENESIS_ADDRESS});
    await ftsoManager.activate({from: GOVERNANCE_GENESIS_ADDRESS});

    const ftso = await Ftso.new("TOKEN", 5, priceSubmitter.address, wNatMock.address, ftsoManager.address, startTs, 60, 5, 1, 10000, 200);
    await ftsoManager.addFtso(ftso.address, { from: GOVERNANCE_GENESIS_ADDRESS });

  });
  
  beforeEach(async () => {
    validatorRegistry = await ValidatorRegistry.new();
  });

  it("Should set nodeId", async() => {
    let nodeId1 = web3.utils.randomHex(20);
    await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
    await validatorRegistry.registerNodeIdAsDataProvider(nodeId1, { from: accounts[1] });

    let nodeId2 = web3.utils.randomHex(20);
    await voterWhitelister.requestFullVoterWhitelisting(accounts[2]);
    await validatorRegistry.registerNodeIdAsDataProvider(nodeId2, { from: accounts[2] });

    expect(await validatorRegistry.getNodeIdForDataProvider(accounts[1])).to.equals(nodeId1);
    expect(await validatorRegistry.getDataProviderForNodeId(nodeId1)).to.equals(accounts[1]);

    expect(await validatorRegistry.getNodeIdForDataProvider(accounts[2])).to.equals(nodeId2);
    expect(await validatorRegistry.getDataProviderForNodeId(nodeId2)).to.equals(accounts[2]);

    expect(await validatorRegistry.getNodeIdForDataProvider(accounts[3])).to.equals("0x0000000000000000000000000000000000000000");
    expect(await validatorRegistry.getDataProviderForNodeId(web3.utils.randomHex(20))).to.equals(constants.ZERO_ADDRESS);
  });

  it("Should revert if data provider is not whitelisted", async() => {
    let nodeId1 = web3.utils.randomHex(20);
    let setNodeId = validatorRegistry.registerNodeIdAsDataProvider.call(nodeId1, { from: accounts[3] });
    await expectRevert(setNodeId, "not whitelisted");
  });

  it("Should revert if data provider wants to use nodeId which is already in use", async() => {
    let nodeId1 = web3.utils.randomHex(20);
    await voterWhitelister.requestFullVoterWhitelisting(accounts[1]);
    await validatorRegistry.registerNodeIdAsDataProvider(nodeId1, { from: accounts[1] });

    expect(await validatorRegistry.getNodeIdForDataProvider(accounts[1])).to.equals(nodeId1);
    expect(await validatorRegistry.getDataProviderForNodeId(nodeId1)).to.equals(accounts[1]);

    let setNodeId = validatorRegistry.registerNodeIdAsDataProvider.call(nodeId1, { from: accounts[3] });
    await expectRevert(setNodeId, "node id already in use");
  });
  
});


