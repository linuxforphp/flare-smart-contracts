const getTestFile = require('../../utils/constants').getTestFile;
const CheckPointHistoryMock = artifacts.require("CheckPointHistoryMock");

contract(`CheckPointHistory.sol; ${getTestFile(__filename)}`, async accounts => {
  // a fresh contract for each test
  let checkPointHistoryMock;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    checkPointHistoryMock = await CheckPointHistoryMock.new();
  });

  it("Should store value now", async () => {
    // Assemble
    // Act
    await checkPointHistoryMock.writeValueAtNow(10);
    // Assert
    let value = await checkPointHistoryMock.valueAtNow();
    assert.equal(value, 10);
  });

  it("Should store values at checkpoints", async() => {
    const b = [];
    // Assemble
    b[0] = await web3.eth.getBlockNumber();
    await checkPointHistoryMock.writeValueAtNow(50);
    b[1] = await web3.eth.getBlockNumber();
    await checkPointHistoryMock.writeValueAtNow(10);
    b[2] = await web3.eth.getBlockNumber();
    await checkPointHistoryMock.writeValueAtNow(5);
    b[3] = await web3.eth.getBlockNumber();
    // Act
    let balanceAtBlock0 = await checkPointHistoryMock.valueAt(b[0]);
    let balanceAtBlock1 = await checkPointHistoryMock.valueAt(b[1]);
    let balanceAtBlock2 = await checkPointHistoryMock.valueAt(b[2]);
    let balanceAtBlock3 = await checkPointHistoryMock.valueAt(b[3]);
    // Assert
    assert.equal(balanceAtBlock0, 0);
    assert.equal(balanceAtBlock1, 50);
    assert.equal(balanceAtBlock2, 10);
    assert.equal(balanceAtBlock3, 5);
  });

  it("Should modify checkpoints created in the past", async() => {
    const b = [];
    // Assemble
    b[0] = await web3.eth.getBlockNumber();
    await checkPointHistoryMock.writeValueAtNow(50);
    b[1] = await web3.eth.getBlockNumber();
    await checkPointHistoryMock.writeValueAtNow(10);
    b[2] = await web3.eth.getBlockNumber();
    await checkPointHistoryMock.writeValueAtNow(5);
    b[3] = await web3.eth.getBlockNumber();
    // Act
    await checkPointHistoryMock.writeValueAt(20, b[2]);
    let balanceAtBlock2 = await checkPointHistoryMock.valueAt(b[2]);
    // Assert
    assert.equal(balanceAtBlock2, 20);
  })
});