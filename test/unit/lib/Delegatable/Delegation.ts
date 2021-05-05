// Unit tests for Delegatable behavior library, delegation activity

import { DelegatableMockContract, DelegatableMockInstance } from "../../../../typechain-truffle";
import { toBN } from "../../../utils/test-helpers";

const {getTestFile} = require('../../../utils/constants');

const truffleAssert = require('truffle-assertions');

const Delegatable = artifacts.require("DelegatableMock") as DelegatableMockContract;

contract(`Delegatable.sol; ${getTestFile(__filename)}; Delegation unit tests`, async accounts => {
  // contains a fresh contract for each test
  let delegatable: DelegatableMockInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    delegatable = await Delegatable.new();
  });

  it("Should add a voting power delegation by percentage", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    await delegatable.delegate(accounts[2], 1000, {from: accounts[1]});
    const { delegateAddresses, amountOrBips, } = await delegatable.delegatesOf(accounts[1]) as any;
    // Assert
    assert.equal(delegateAddresses[0], accounts[2]);
    assert.equal(amountOrBips[0], 1000);
  });

  it("Should emit delegate event when delegate by percentage successful", async() => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    let tx = await delegatable.delegate(accounts[2], 5000, {from: accounts[1]});
    let blockNumber = await web3.eth.getBlockNumber();

    // Assert
    await truffleAssert.eventEmitted(tx, 'Delegate', (ev: any) => {
      return ev.from == accounts[1] && 
        ev.to == accounts[2] && ev.votePower == 50 && 
        ev.blockNumber == blockNumber;
    });
  });

  it("Should add an explicit voting power delegation", async () => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    await delegatable.delegateExplicit(accounts[2], 10, {from: accounts[1]});
    const { delegateAddresses, amountOrBips, count, delegationMode } = await delegatable.delegatesOf(accounts[1]) as any;
    // Assert
    assert.equal(delegateAddresses[0], accounts[2]);
    assert.equal(amountOrBips[0], 10);
    assert.equal(count, 1);
    assert.equal(delegationMode, 2);
  });

  it("Should emit delegate event when explicit delegate successful", async() => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    // Act
    let tx = await delegatable.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    let blockNumber = await web3.eth.getBlockNumber();

    // Assert
    await truffleAssert.eventEmitted(tx, 'Delegate', (ev: any) => {
      return ev.from == accounts[1] && 
        ev.to == accounts[2] && 
        ev.votePower == 50 && 
        ev.blockNumber == blockNumber;
    });
  });

  it("Should get delegation mode when delegated by percent", async() => {
    // Assemble
    await delegatable.delegate(accounts[2], 5000, {from: accounts[1]});
    // Act
    let delegationMode = await delegatable.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(delegationMode as any, 1);
  });

  it("Should get delegation mode when explicitly delegated by amount", async() => {
    // Assemble
    await delegatable.mintVotePower(accounts[1], 100);
    await delegatable.delegateExplicit(accounts[2], 10, {from: accounts[1]});
    // Act
    let delegationMode = await delegatable.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(delegationMode as any, 2);
  });
});