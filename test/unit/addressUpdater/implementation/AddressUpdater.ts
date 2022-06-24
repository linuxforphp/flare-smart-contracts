
import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import { AddressUpdaterInstance } from "../../../../typechain-truffle";
import { assertNumberEqual, encodeContractNames } from '../../../utils/test-helpers';

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

  it("Should get contract names and addresses - updates executed", async() => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    await addressUpdater.executeContractNamesAndAddressesChange(1000);
    // Act
    const {0: names, 1: addresses} = await addressUpdater.getContractNamesAndAddresses();
    // Assert
    assert.equal(names[0], FTSO_MANAGER_NAME);
    assert.equal(names[1], ADDRESS_UPDATER_NAME);
    assert.equal(addresses[0], FTSO_MANAGER_ADDRESS);
    assert.equal(addresses[1], addressUpdater.address);
  });

  it("Should get contract names and addresses - updates effective but not executed", async () => {
    // Assemble
    await addressUpdater.addOrUpdateContractNamesAndAddresses([FTSO_MANAGER_NAME, ADDRESS_UPDATER_NAME], [FTSO_MANAGER_ADDRESS, addressUpdater.address], { from: GOVERNANCE_ADDRESS });
    // Act
    const { 0: names, 1: addresses } = await addressUpdater.getContractNamesAndAddresses();
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

  it("Should partially update addresses with timelock", async () => {
    async function compareState(expectedNames: string[], expectedAddresses: string[], expectedChangesToExecute: number) {
      const { 0: names, 1: addresses } = await addressUpdater.getContractNamesAndAddresses();
      assert.equal(names.length, addresses.length);
      assert.equal(names.length, expectedNames.length);
      assert.equal(addresses.length, expectedAddresses.length);
      for (let i = 0; i < names.length; i++) {
        assert.equal(names[i], expectedNames[i], `Different name on index ${i} (${names[i]} != ${expectedNames[i]})`);
        assert.equal(addresses[i], expectedAddresses[i], `Different address on index ${i} (${names[i]})`);
        const addressFromGet = await addressUpdater.getContractAddress(names[i]);
        assert.equal(addressFromGet, expectedAddresses[i], `Different address from getContractAddress on index ${i} (${names[i]})`);
      }
      const changesToExecute = await addressUpdater.contractNamesAndAddressesChangesToExecute();
      assert.equal(Number(changesToExecute), expectedChangesToExecute, `Expected ${expectedChangesToExecute} changes ready to execute`);
    }
    // test cases
    const indexes1 = [0, 1, 3, 4, 5, 8];
    const names1 = indexes1.map(i => `Contract_${i}`);
    const addresses1 = indexes1.map(i => accounts[10 + i]);
    const indexes2 = [1, 2, 4, 6, 7, 9];
    const names2 = indexes2.map(i => `Contract_${i}`);
    const addresses2 = indexes2.map(i => accounts[20 + i]);
    // ans merged results
    const resultIndexes = [0, 1, 3, 4, 5, 8, 2, 6, 7, 9];
    const resultAddrMap: Record<number, number> = { 0: 10, 1: 21, 2: 22, 3: 13, 4: 24, 5: 15, 6: 26, 7: 27, 8: 18, 9: 29 };
    const resultNames = resultIndexes.map(i => `Contract_${i}`);
    const resultAddresses = resultIndexes.map(i => accounts[resultAddrMap[i]]);
    // test empty
    await compareState([], [], 0);
    // PART 1: test initial setting with timelock 0
    await addressUpdater.addOrUpdateContractNamesAndAddresses(names1, addresses1, { from: GOVERNANCE_ADDRESS });
    await compareState(names1, addresses1, 6);
    // and after execute
    await addressUpdater.executeContractNamesAndAddressesChange(100);
    await compareState(names1, addresses1, 0);
    // PART 2: change timelock
    await addressUpdater.setTimelock(100, { from: GOVERNANCE_ADDRESS });
    // update setting - nothing should change before timelock and the execute method should revert
    await addressUpdater.addOrUpdateContractNamesAndAddresses(names2, addresses2, { from: GOVERNANCE_ADDRESS });
    await compareState(names1, addresses1, 0);
    await expectRevert(addressUpdater.executeContractNamesAndAddressesChange(100), "timelock still active");
    // PART 3: wait for setting to become effective
    await time.increase(100);
    // reading should return effective settings
    await compareState(resultNames, resultAddresses, 6);
    // partial execute should only change the number of non-executed
    await addressUpdater.executeContractNamesAndAddressesChange(2);
    await compareState(resultNames, resultAddresses, 4);
    // full execute should only change the number of non-executed
    await addressUpdater.executeContractNamesAndAddressesChange(4);
    await compareState(resultNames, resultAddresses, 0);
  });

  it("Updating timelock should also be timelocked", async () => {
    // first timelock change is immediate, since initially timelock is 0
    await addressUpdater.setTimelock(100, { from: GOVERNANCE_ADDRESS });
    assertNumberEqual(await addressUpdater.getTimelock(), 100);
    // second change does not take effect immediatelly
    await addressUpdater.setTimelock(50, { from: GOVERNANCE_ADDRESS });
    assertNumberEqual(await addressUpdater.updatedTimelock(), 50);
    assertNumberEqual(await addressUpdater.getTimelock(), 100);
    const effectiveAt = await addressUpdater.updatedTimelockEffectiveAt();
    // timelocked settings should become effective within 100 seconds
    const timestamp = await time.latest();
    assert.isTrue(effectiveAt.gt(timestamp.addn(95)));
    assert.isTrue(effectiveAt.lte(timestamp.addn(100)));
    // skip too little time - timelock shouldn't change yet
    await time.increaseTo(effectiveAt.subn(5));
    assertNumberEqual(await addressUpdater.getTimelock(), 100);
    // after some more skip, timelock should change
    await time.increaseTo(effectiveAt);
    assertNumberEqual(await addressUpdater.getTimelock(), 50);
    // setting contract addresses should flush the update
    await addressUpdater.addOrUpdateContractNamesAndAddresses([], [], { from: GOVERNANCE_ADDRESS });
    assertNumberEqual(await addressUpdater.getTimelock(), 50);
    assertNumberEqual(await addressUpdater.updatedTimelock(), 50);
    assertNumberEqual(await addressUpdater.updatedTimelockEffectiveAt(), 0);  // effectiveAt=0 => no update pending
  });
});
