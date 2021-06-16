import { WFlrContract, WFlrInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";

const calcGasCost = require('../../utils/eth').calcGasCost;
const { constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const WFLR = artifacts.require("WFlr") as WFlrContract;
const TransferToWflr = artifacts.require("TransferToWflrMock");

const ALLOWANCE_EXCEEDED_MSG = "allowance below zero";

contract(`WFlr; ${getTestFile(__filename)}`, async accounts => {
  // a fresh contract for each test
  let wflr: WFlrInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    wflr = await WFLR.new(accounts[0]);
    await setDefaultVPContract(wflr, accounts[0]);
  });

  it("Should accept FLR deposits.", async () => {
    // Assemble
    let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    // Act
    let depositResult = await wflr.deposit({value: toBN(20), from:accounts[1]});
    // Assert
    let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    // Compute the gas cost of the depositResult
    let txCost = await calcGasCost(depositResult);
    // Compute opening vs closing balance difference less gas cost
    assert.equal(flrOpeningBalance.sub(flrClosingBalance).sub(txCost) as any, 20);
  });

  it("Should issue WFLR when FLR deposited.", async () => {
    // Assemble
    // Act
    await wflr.deposit({value: toBN(20), from:accounts[1]});
    let balance = await wflr.balanceOf(accounts[1]);
    let totalBalance = await wflr.totalSupply();
    // Assert
    assert.equal(balance as any, 20);
    assert.equal(totalBalance as any, 20);
  });
  
  it("Should not deposit to zero", async () => {
    // Assemble
    // Act
    let callPromise = wflr.depositTo(constants.ZERO_ADDRESS, { value: toBN(2000) });
    // Assert
    await expectRevert(callPromise, "Cannot deposit to zero address");
  });

  it("Should burn WFLR when FLR withdrawn.", async () => {
    // Assemble
    await wflr.deposit({value: toBN(50), from:accounts[1]});
    // Act
    await wflr.withdraw(10, {from:accounts[1]});
    let balance = await wflr.balanceOf(accounts[1]);
    let totalBalance = await wflr.totalSupply();
    // Assert
    assert.equal(balance as any, 40);
    assert.equal(totalBalance as any, 40);
  });
  
  it("Should redeem FLR withdrawn.", async () => {
    // Assemble
    await wflr.deposit({value: toBN(50), from:accounts[1]});
    let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    // Act
    let withdrawResult = await wflr.withdraw(10, {from:accounts[1]});
    let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let txCost = await calcGasCost(withdrawResult);
    // Assert
    assert.equal(flrOpeningBalance.sub(flrClosingBalance).sub(txCost) as any, -10);
  });

  it("Should accept FLR deposits from another account.", async () => {
    // Assemble
    let a1FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));

    // Act
    let depositResult = await wflr.depositTo(accounts[2], {value: toBN(20), from:accounts[1]});

    // Assert
    let a1FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    let a2WflrBalance = await wflr.balanceOf(accounts[2]);
    // Compute the gas cost of the depositResult
    let txCost = await calcGasCost(depositResult);
    // Compute opening vs closing balance difference less gas cost for A1
    assert.equal(a1FlrOpeningBalance.sub(a1FlrClosingBalance).sub(txCost) as any, 20);
    // FLR should be in A2
    assert.equal(a2FlrClosingBalance.sub(a2FlrOpeningBalance) as any, 20);
    // WFLR for A2 should have been minted
    assert.equal(a2WflrBalance as any, 20);
  });

  it("Should burn WFLR when FLR withdrawn to another address with allowance.", async () => {
    // Assemble
    await wflr.deposit({value: toBN(50), from:accounts[1]});
    // Allow A2 to withdraw 30 from A1
    await wflr.increaseAllowance(accounts[2], 30, {from: accounts[1]})
    // Get the opening balances
    let a1FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    // Act
    // A1 spending by burning WFLR and moving FLR to A2
    let withdrawResult = await wflr.withdrawFrom(accounts[1], 30, {from: accounts[2]});
    // Assert
    // Compute the gas cost of the withdrawResult
    let txCost = await calcGasCost(withdrawResult);
    // Get the closing balances
    let a1FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
    let a2FlrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[2]));
    let a1Wflrbalance = await wflr.balanceOf(accounts[1]);
    assert.equal(a1Wflrbalance.toNumber(), 20);
    assert.equal(a2FlrClosingBalance.sub(a2FlrOpeningBalance).add(txCost).toNumber(), 30);
    assert.equal(a1FlrOpeningBalance.sub(a1FlrClosingBalance).toNumber(), 0);
  });

  it("Should revert when withdrawn to another address without allowance.", async () => {
    // Assemble
    await wflr.deposit({value: toBN(50), from:accounts[1]});
    await wflr.increaseAllowance(accounts[1], 20, {from: accounts[2]})
    // Act
    // A1 spending by burning WFLR and moving FLR to A2, but allowance too low
    let withdrawPromise = wflr.withdrawFrom(accounts[1], 30, {from: accounts[2]});
    // Assert
    await expectRevert(withdrawPromise, ALLOWANCE_EXCEEDED_MSG);
  });

  it("Should receive flares and update balance via direct flare transfer (web3 send)", async () => {
    // Assemble
    // Act
    await web3.eth.sendTransaction({ to: wflr.address, value: toBN(8000), from: accounts[1] });
    // Assert
    const balance = await wflr.balanceOf(accounts[1]);
    assert.equal(balance.toNumber(), 8000);
  });

  it("Should not receive flares without calling deposit due to gas shortage - via transfer (2300 gas)", async () => {
    // Assemble
    const transferer = await TransferToWflr.new();
    await transferer.send(5e18);
    // Act
    let callPromise = transferer.transferToWflr(wflr.address, 8500);
    // Assert
    await expectRevert.unspecified(callPromise);
    const balance = await wflr.balanceOf(transferer.address);
    assert.equal(balance.toNumber(), 0);
  });

  it("Should not receive flares without calling deposit due to gas shortage - via transfer (2300 gas), event if deposited before", async () => {
    // Assemble
    const transferer = await TransferToWflr.new();
    await transferer.send(5e18);
    // Act
    await transferer.depositToWflr(wflr.address, 1500);
    let callPromise = transferer.transferToWflr(wflr.address, 8500);
    // Assert
    await expectRevert.unspecified(callPromise);
    const balance = await wflr.balanceOf(transferer.address);
    assert.equal(balance.toNumber(), 1500);
  });

  it("Should not receive flares without calling deposit - via unknown function call", async () => {
    // Assemble
    let funcCall = web3.eth.abi.encodeFunctionCall({ name: 'some_name', type: 'function', inputs: [] }, []);
    // Act
    let callPromise = web3.eth.call({ to: wflr.address, value: toBN(50), data: funcCall });
    // Assert
    await expectRevert(callPromise, "function selector was not recognized and there's no fallback function");
  });

  it("Should emit event on deposit.", async () => {
    // Assemble
    // Act
    let depositResult = await wflr.deposit({ value: toBN(20), from: accounts[1] });
    // Assert
    expectEvent(depositResult, "Deposit", { dst: accounts[1], amount: toBN(20) });
  });

  it("Should emit event on depositTo.", async () => {
    // Assemble
    // Act
    let depositResult = await wflr.depositTo(accounts[2], { value: toBN(20), from: accounts[1] });
    // Assert
    expectEvent(depositResult, "Deposit", { dst: accounts[2], amount: toBN(20) });
  });

  it("Should emit event on withdrawal.", async () => {
    // Assemble
    await wflr.deposit({ value: toBN(20), from: accounts[1] });
    // Act
    let withdrawResult = await wflr.withdraw(toBN(10), { from: accounts[1] });
    // Assert
    expectEvent(withdrawResult, "Withdrawal", { src: accounts[1], amount: toBN(10) });
  });

  it("Should emit event on withdrawalFrom.", async () => {
    // Assemble
    await wflr.deposit({ value: toBN(20), from: accounts[1] });
    await wflr.approve(accounts[2], toBN(10), { from: accounts[1] });
    // Act
    let withdrawResult = await wflr.withdrawFrom(accounts[1], toBN(10), { from: accounts[2] });
    // Assert
    expectEvent(withdrawResult, "Withdrawal", { src: accounts[1], amount: toBN(10) });
  });
});
