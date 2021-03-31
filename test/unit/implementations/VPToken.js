// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
const {constants, expectRevert} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock");

const ALREADY_DELEGATED_EXPLICIT_MSG = "Already delegated explicitly";
const ALREADY_DELEGATED_PERCENT_MSG = "Already delegated by percentage";


contract(`VPToken.sol; ${getTestFile(__filename)}; Check point unit tests`, async accounts => {
  // contains a fresh contract for each test
  let vpToken;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    vpToken = await VPToken.new("A token", "ATOK");
  });

  it("Should be checkpointable", async() => {
    const b = [];
    // Assemble
    b[0] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 50);
    b[1] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 10);
    b[2] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 5);
    // Act
    let balanceAtBlock0 = await vpToken.balanceOfAt(accounts[1], b[0]);
    let balanceAtBlock1 = await vpToken.balanceOfAt(accounts[1], b[1]);
    let balanceAtBlock2 = await vpToken.balanceOfAt(accounts[1], b[2]);
    let balanceAtNow = await vpToken.balanceOf(accounts[1]);
    // Assert
    assert.equal(balanceAtBlock0, 0);
    assert.equal(balanceAtBlock1, 50);
    assert.equal(balanceAtBlock2, 60);
    assert.equal(balanceAtNow, 65);
  });

  it("Should be delegatable by percentage", async() => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, {from: accounts[1]});
    await vpToken.delegate(accounts[3], 50, {from: accounts[1]});
    // Act
    const { delegateAddresses, amountOrBips, count, delegationMode} = await vpToken.delegatesOf(accounts[1]);
    // Assert
    assert.equal(delegateAddresses[0], accounts[2]);
    assert.equal(amountOrBips[0], 50);
    assert.equal(delegateAddresses[1], accounts[3]);
    assert.equal(amountOrBips[1], 50);
    assert.equal(count, 2);
    assert.equal(delegationMode, 1);
  });

  it("Should undelegate all", async() => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, {from: accounts[1]});
    await vpToken.delegate(accounts[3], 50, {from: accounts[1]});
    // Act
    await vpToken.undelegateAll({from: accounts[1]});
    // Assert
    const { delegateAddresses, amountOrBips, count, delegationMode} = await vpToken.delegatesOf(accounts[1]);
    assert.equal(count, 0);
    assert.equal(delegationMode, 0);
  });

  it("Should be explicitly delegatable", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 75, {from: accounts[1]});
    // Act
    const { delegateAddresses, amountOrBips, } = await vpToken.delegatesOf(accounts[1]);
    // Assert
    assert.equal(delegateAddresses[0], accounts[2]);
    assert.equal(amountOrBips[0], 75);
  });

  it("Should retrieve undelegated vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    let undelegatedVotePower = await vpToken.undelegatedVotePowerOf(accounts[1]);
    // Assert
    assert.equal(undelegatedVotePower, 50);
  });

  it("Should transfer vote power from address 1 to address 2", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    await vpToken.mint(accounts[2], 10);
    // Act
    await vpToken.transfer(accounts[2], 5, {from: accounts[1]});
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    let account2VP = await vpToken.votePowerOf(accounts[2]);
    assert.equal(account1VP, 45);
    assert.equal(account2VP, 15);
  });

  it("Should transfer historic balance from address 1 to address 2", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    await vpToken.mint(accounts[2], 10);
    // Act
    await vpToken.transfer(accounts[2], 5, {from: accounts[1]});
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    let account2balance = await vpToken.balanceOfAt(accounts[2], await web3.eth.getBlockNumber());
    assert.equal(account1balance, 45);
    assert.equal(account2balance, 15);
  });

  it("Should burn vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    assert.equal(account1VP, 45);
  });

  it("Should burn historic balance", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    assert.equal(account1balance, 45);
  });

  it("Should revert delegating by percent when already delegated explicit", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    // Act
    let delegatePromise = vpToken.delegate(accounts[2], 1000, {from: accounts[1]});
    // Assert
    expectRevert(delegatePromise, ALREADY_DELEGATED_EXPLICIT_MSG);
  });

  it("Should revert delegating explicit when already delegated by percent", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 1000, {from: accounts[1]});
    // Act
    let delegatePromise = vpToken.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    // Assert
    expectRevert(delegatePromise, ALREADY_DELEGATED_PERCENT_MSG);
  });

  it("Should sum minted vote power", async() => {
    // Assemble
    // Act
    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    // Assert
    assert.equal(await vpToken.votePower(), 30);
  });  

  it("Should net total vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    assert.equal(await vpToken.votePower(), 25);
  });

  it("Should record historic vote power", async() => {
    // Assemble
    const b = [];
    let blockAfterFirstMinting = 0;

    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    b[blockAfterFirstMinting] = await web3.eth.getBlockNumber();

    // Act
    await vpToken.mint(accounts[2], 50);

    // Assert
    assert.equal(await vpToken.votePowerAt(b[blockAfterFirstMinting]), 30);
  });

  it("Should leave total vote power alone when delegating", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 20);
    // Act
    await vpToken.delegate(accounts[2], 5, {from: accounts[1]});
    // Assert
    assert.equal(await vpToken.votePower(), 20);
  });  
});