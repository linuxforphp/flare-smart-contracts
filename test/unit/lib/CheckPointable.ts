import { CheckPointableMockContract, CheckPointableMockInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";

// Unit tests for CheckPointable through CheckPointableMock contract
const {expectRevert, constants} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const CheckPointable = artifacts.require("CheckPointableMock") as CheckPointableMockContract;

contract(`CheckPointable.sol; ${getTestFile(__filename)}; CheckPointable unit tests`, async accounts => {
  // contains a fresh contract for each test
  let checkPointable: CheckPointableMockInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    checkPointable = await CheckPointable.new();
  });

  it("Should store historic balance for address", async() => {
    const b = [];
    // Assemble
    await checkPointable.mintForAtNow(accounts[1], 10);
    b[0] = await web3.eth.getBlockNumber();
    await checkPointable.mintForAtNow(accounts[1], 20);
    // Act
    let value = await checkPointable.balanceOfAt(accounts[1], b[0]);
    // Assert
    assert.equal(value as any, 10);
  });

  it("Should store historic supply", async() => {
    const b = [];
    // Assemble
    await checkPointable.mintForAtNow(accounts[1], 10);
    await checkPointable.mintForAtNow(accounts[2], 20);
    b[0] = await web3.eth.getBlockNumber();
    await checkPointable.burnForAtNow(accounts[2], 10);
    // Act
    let value = await checkPointable.totalSupplyAt(b[0]);
    // Assert
    assert.equal(value as any, 30);
  });

  it("Should transmit value now for historic retrieval", async() => {
    const b = [];
    // Assemble
    await checkPointable.mintForAtNow(accounts[1], 10);
    await checkPointable.mintForAtNow(accounts[2], 20);
    // Act
    await checkPointable.transmitAtNow(accounts[2], accounts[1], 10);
    b[0] = await web3.eth.getBlockNumber();
    await checkPointable.burnForAtNow(accounts[2], 10);
    b[1] = await web3.eth.getBlockNumber();
    // Assert
    let account2PastValue = await checkPointable.balanceOfAt(accounts[2], b[0]);
    let account2Value = await checkPointable.balanceOfAt(accounts[2], b[1]);
    assert.equal(account2PastValue as any, 10);
    assert.equal(account2Value as any, 0);
  });
});
