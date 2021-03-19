// Unit tests for VotePower through VotePowerMock contract
const {expectRevert, constants} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const VotePower = artifacts.require("VotePowerMock");

contract(`VotePower.sol; ${getTestFile(__filename)}; Vote power unit tests`, async accounts => {
  // contains a fresh contract for each test
  let votePower;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    votePower = await VotePower.new();
  });

  it("Should mint vote power for an address", async() => {
    // Assemble
    // Act
    await votePower._mint(accounts[1], 10);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]), 10);
  });

  it("Should not mint the zero address", async() => {
    // Assemble
    // Act
    let mintPromise = votePower._mint(constants.ZERO_ADDRESS, 10);
    // Assert
    await expectRevert.assertion(mintPromise);
  });

  it("Should burn vote power for an address", async() => {
    // Assemble
    await votePower._mint(accounts[1], 10);
    // Act
    await votePower._burn(accounts[1], 6);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]), 4);
  });

  it("Should not burn the zero address", async() => {
    // Assemble
    // Act
    let burnPromise = votePower._burn(constants.ZERO_ADDRESS, 10);
    // Assert
    await expectRevert.assertion(burnPromise);
  });

  it("Should not burn more than minted for an address", async() => {
    // Assemble
    // Act
    let burnPromise = votePower._burn(accounts[1], 10);
    // Assert
    await expectRevert(burnPromise, "SafeMath: subtraction overflow");
  });

  it("Should record historic vote power for an address", async() => {
    // Assemble
    const b = [];
    let blockAfterFirstMinting = 0;

    await votePower._mint(accounts[1], 10);
    await votePower._mint(accounts[2], 20);
    b[blockAfterFirstMinting] = await web3.eth.getBlockNumber();

    // Act
    await votePower._mint(accounts[2], 50);

    // Assert
    assert.equal(await votePower.votePowerOfAt(accounts[2], b[blockAfterFirstMinting]), 20);
  });

  it("Should transmit vote power", async() => {
    // Assemble
    await votePower._mint(accounts[1], 20);
    // Act
    await votePower.transmit(accounts[1], accounts[2], 5);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]), 15);
    assert.equal(await votePower.votePowerOfAtNow(accounts[2]), 5);
  });

  it("Should delegate vote power", async() => {
    // Assemble
    await votePower._mint(accounts[1], 20);
    // Act
    await votePower.delegate(accounts[1], accounts[2], 5);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]), 15);
    assert.equal(await votePower.votePowerOfAtNow(accounts[2]), 5);
    assert.equal(await votePower.votePowerFromToAtNow(accounts[1], accounts[2]), 5);
  });

  it("Should record historic delegated vote power", async() => {
    // Assemble
    const b = [];
    let blockAfterFirstDelegate = 0;

    await votePower._mint(accounts[1], 20);
    await votePower.delegate(accounts[1], accounts[2], 5);
    b[blockAfterFirstDelegate] = await web3.eth.getBlockNumber();
    // Act
    await votePower.delegate(accounts[1], accounts[2], 7);
    // Assert
    assert.equal(await votePower.votePowerFromToAt(accounts[1], accounts[2], b[blockAfterFirstDelegate]), 5);
  });

  it("Should undelegate vote power", async() => {
    // Assemble
    await votePower._mint(accounts[1], 20);
    await votePower.delegate(accounts[1], accounts[2], 10);
    // Act
    await votePower.undelegate(accounts[1], accounts[2], 3);
    // Assert
    assert.equal(await votePower.votePowerOfAtNow(accounts[1]), 13);
    assert.equal(await votePower.votePowerOfAtNow(accounts[2]), 7);
    assert.equal(await votePower.votePowerFromToAtNow(accounts[1], accounts[2]), 7);
  });

  it("Should revoke vote power", async() => {
    // Assemble
    const b = [];
    let blockAfterFirstDelegate = 0;

    await votePower._mint(accounts[1], 20);
    await votePower.delegate(accounts[1], accounts[2], 10);
    b[blockAfterFirstDelegate] = await web3.eth.getBlockNumber();
    await votePower.undelegate(accounts[1], accounts[2], 3);
    // Act
    await votePower.revokeAt(accounts[1], accounts[2], b[blockAfterFirstDelegate]);
    // Assert
    assert.equal(await votePower.votePowerFromToAt(accounts[1], accounts[2], b[blockAfterFirstDelegate]), 0);
  });
});