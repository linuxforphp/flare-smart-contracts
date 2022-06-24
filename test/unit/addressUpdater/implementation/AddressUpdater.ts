
import { constants, expectRevert } from '@openzeppelin/test-helpers';
import { AddressUpdaterInstance } from "../../../../typechain-truffle";
import { encodeContractNames } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;
const AddressUpdater = artifacts.require("AddressUpdater");
const AddressUpdatableMock = artifacts.require("AddressUpdatableMock");
const MockContract = artifacts.require("MockContract");


contract(`AddressUpdater.sol; ${getTestFile(__filename)}; AddressUpdater contract unit tests`, async accounts => {
  let addressUpdater: AddressUpdaterInstance;
  const GOVERNANCE_ADDRESS = accounts[10];
  
  const ADDRESS_UPDATER_NAME = "AddressUpdater";
  const FTSO_MANAGER_NAME = "FtsoManager";
  const FTSO_MANAGER_ADDRESS = accounts[11];

  beforeEach(async() => {
    addressUpdater = await AddressUpdater.new(GOVERNANCE_ADDRESS);
  });

  it("Should know about governance", async() => {
    // Assemble
    // Act
    const governance = await addressUpdater.governance();
    // Assert
    assert.equal(GOVERNANCE_ADDRESS, governance);
  });

  it("Should add new contract address", async() => {
    // Assemble
    // Act
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    const ftsoManagerAddress = await addressUpdater.getContractAddress(FTSO_MANAGER_NAME);
    // Assert
    assert.equal(FTSO_MANAGER_ADDRESS, ftsoManagerAddress);
  });

  it("Should add and update contract addresses", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    const newFtsoManagerAddress = accounts[12];
    // Act
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [newFtsoManagerAddress, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    const ftsoManagerAddress = await addressUpdater.getContractAddress(FTSO_MANAGER_NAME);
    const addressUpdaterAddress = await addressUpdater.getContractAddress(ADDRESS_UPDATER_NAME);
    // Assert
    assert.notEqual(FTSO_MANAGER_ADDRESS, ftsoManagerAddress);
    assert.equal(addressUpdater.address, addressUpdaterAddress);
  });

  it("Should get contract names and addresses", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    // Act
    const {0: names, 1: addresses} = await addressUpdater.getContractNamesAndAddresses();
    // Assert
    assert.equal(names[0], FTSO_MANAGER_NAME);
    assert.equal(names[1], ADDRESS_UPDATER_NAME);
    assert.equal(addresses[0], FTSO_MANAGER_ADDRESS);
    assert.equal(addresses[1], addressUpdater.address);
  });

  it("Should revert getting address if contract is unknown", async() => {
    // Assemble
    // Act
    const ftsoManagerAddressPromise = addressUpdater.getContractAddress(FTSO_MANAGER_NAME);
    // Assert
    await expectRevert(ftsoManagerAddressPromise, "address zero")
  });

  it("Should revert setting addresses if invalid paramters are sent", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS], { from: GOVERNANCE_ADDRESS });
    // Assert
    await expectRevert(updatePromise, "array lengths do not match")
  });

  it("Should revert setting addresses if address(0) is sent", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, constants.ZERO_ADDRESS], { from: GOVERNANCE_ADDRESS });
    // Assert
    await expectRevert(updatePromise, "address zero")
  });

  it("Should revert setting addresses if not from governance", async() => {
    // Assemble
    // Act
    const updatePromise = addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME], [FTSO_MANAGER_ADDRESS], { from: accounts[0] });
    // Assert
    await expectRevert(updatePromise, "only governance")
  });

  it("Should update addresses on addressUpdatable contract", async() => {
    // Assemble
    const addressUpdatable = await MockContract.new();
    const addressUpdatableInterface = await AddressUpdatableMock.new(addressUpdater.address);
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    // Act
    await addressUpdater.updateContractAddresses([addressUpdatable.address], { from: GOVERNANCE_ADDRESS });
    // Assert
    const updateContractAddresses = addressUpdatableInterface.contract.methods.updateContractAddresses(
      encodeContractNames([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME]), 
      [FTSO_MANAGER_ADDRESS, addressUpdater.address]).encodeABI();
    const invocationCount = await addressUpdatable.invocationCountForCalldata.call(updateContractAddresses);
    assert.equal(invocationCount.toNumber(), 1);
  });

  it("Should revert updating addresses if not from governance", async() => {
    // Assemble
    const addressUpdatable = await MockContract.new();
    // Act
    const updatePromise = addressUpdater.updateContractAddresses([addressUpdatable.address], { from: accounts[0] });
    // Assert
    await expectRevert(updatePromise, "only governance")
  });

});
