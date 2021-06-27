
import { FtsoRegistryInstance, MockContractInstance } from "../../../../typechain-truffle";
import { createMockSupplyContract } from "../../../utils/FTSO-test-utils";

const getTestFile = require('../../../utils/constants').getTestFile;
const MockFtso = artifacts.require("MockFtso");
const FtsoRegistryContract = artifacts.require("FtsoRegistry");
const MockContract = artifacts.require("MockContract");

const { constants, expectRevert } = require('@openzeppelin/test-helpers');

const ONLY_GOVERNANCE_MSG = "only governance";
const ONLY_FTSO_MANAGER_MSG = "FTSO manager only";
const ERR_TOKEN_NOT_SUPPORTED = "FTSO symbol not supported";

let mockSupplyContract: MockContractInstance;

async function mockFtso(symbol: string){
  return await MockFtso.new(symbol, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, mockSupplyContract.address, 0, 0, 0, 0, 0);
}


contract(`FtsoRegistry.sol; ${getTestFile(__filename)}; FtsoRegistry contract unit tests`, async accounts => {
  let ftsoRegistryContract: FtsoRegistryInstance;
  let mockFtsoContract: MockContractInstance;
  const GOVERNANCE_ADDRESS = accounts[0];
  const MOCK_FTSO_ADDRESS = accounts[123]

  beforeEach(async() => {
    ftsoRegistryContract = await FtsoRegistryContract.new(GOVERNANCE_ADDRESS);
    ftsoRegistryContract.setFtsoManagerAddress(MOCK_FTSO_ADDRESS, {from: GOVERNANCE_ADDRESS});
    mockFtsoContract = await MockContract.new();
    mockSupplyContract = await createMockSupplyContract(GOVERNANCE_ADDRESS, 10000);
  });

  it("Shoud get zero adress for unnsupported symbol ", async() => {
    // Assemble
    const unnsupported_token_promise = ftsoRegistryContract.getFtso("UNSUPPORTED_TOKEN")
    // Act
  
    // Assert
    await expectRevert(unnsupported_token_promise, ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Shoud add new symbol to registry ", async() => {
    // Assemble
    let BTC_FTSO_promisse = ftsoRegistryContract.getFtso("BTC");
    await expectRevert(BTC_FTSO_promisse, ERR_TOKEN_NOT_SUPPORTED);
    // Act
    let BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    const BTC_FTSO_address = await ftsoRegistryContract.getFtso("BTC")
    // Assert
    assert.equal(BTC_FTSO_address, BTCFtsoContractMock.address);
  });

  it("Shoud get all supported tokens ", async() => {
    // Assemble
    const supported_tokens = await ftsoRegistryContract.getSupportedSymbols()
    assert.equal(supported_tokens.length, 0);
    // Act
    let BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    const new_supported_tokens = await ftsoRegistryContract.getSupportedSymbols()
    // Assert
    assert.equal(new_supported_tokens.length, 1);
    assert.isTrue(new_supported_tokens.includes("BTC"))
  });

  it("Shoud update the address of existing active Ftso contract ", async() => {
    // Assemble
    const BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    const BTC_FTSO_address = await ftsoRegistryContract.getFtso("BTC")
    assert.equal(BTC_FTSO_address, BTCFtsoContractMock.address);
    // Act
    const newBTCFtsoContractMock = await mockFtso("BTC");
    const XPRFtsoContractMock = await mockFtso("XPR");
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(newBTCFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    const supported_tokens = await ftsoRegistryContract.getSupportedSymbols()
    const new_BTC_FTSO = await ftsoRegistryContract.getFtso("BTC")
    const XPR_FTSO = await ftsoRegistryContract.getFtso("XPR")
    // Assert
    assert.equal(supported_tokens.length, 2);
    assert.isTrue(supported_tokens.includes("BTC"))
    assert.isTrue(supported_tokens.includes("XPR"))
    assert.equal(new_BTC_FTSO, newBTCFtsoContractMock.address);
    assert.equal(XPR_FTSO, XPRFtsoContractMock.address);
  });

  it("Should record history ", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    const BTCFtsoContractMock_2 = await mockFtso("BTC");
    const BTCFtsoContractMock_3 = await mockFtso("BTC");
    const XPRFtsoContractMock_1 = await mockFtso("XPR");
    const XPRFtsoContractMock_2 = await mockFtso("XPR");
    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock_2.address, {from: MOCK_FTSO_ADDRESS});
    // Act
    const BTC_history = await ftsoRegistryContract.getFtsoHistory("BTC");
    const XPR_history = await ftsoRegistryContract.getFtsoHistory("XPR");
    const ADA_history = await ftsoRegistryContract.getFtsoHistory("ADA");
    // Assert
    assert.equal(BTC_history[0],BTCFtsoContractMock_3.address);
    assert.equal(BTC_history[1],BTCFtsoContractMock_2.address);
    assert.equal(BTC_history[2],BTCFtsoContractMock_1.address);
    assert.equal(BTC_history[3],constants.ZERO_ADDRESS);
    assert.equal(XPR_history[0],XPRFtsoContractMock_2.address);
    assert.equal(XPR_history[1],XPRFtsoContractMock_1.address);
    assert.equal(XPR_history[2],constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0],ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1],constants.ZERO_ADDRESS);
  });

  it("Shoud get all supported tokens and their addresses ", async() => {
    // Assemble
    let BTCFtsoContractMock = await mockFtso("BTC");
    let XPRFtsoContractMock = await mockFtso("XPR");
    let ADAFtsoContractMock = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock.address, {from: MOCK_FTSO_ADDRESS});
    // Act
    const {
      0: tokens,
      1: addresses
    } = await ftsoRegistryContract.getSupportedSymbolsAndFtsos();
    // Assert
    assert.equal(tokens.length, 3);
    assert.equal(addresses[0],BTCFtsoContractMock.address);
    assert.equal(addresses[1],XPRFtsoContractMock.address);
    assert.equal(addresses[2],ADAFtsoContractMock.address);
  });

  it("Should not allow non governance to change ftso manager", async() => {
    // Assemble
    const mockFtsoManager = await MockContract.new();
    // Act
    let promise = ftsoRegistryContract.setFtsoManagerAddress(mockFtsoManager.address, {from: accounts[1]});
    // Assert
    await expectRevert(promise, ONLY_GOVERNANCE_MSG);

  });

  it("Should not allow non Ftso manager address to set address", async() => {
    // Assemble

    // Act
    await ftsoRegistryContract.setFtsoManagerAddress(accounts[15], {from: accounts[0]});
    // Use different address
    const promise = ftsoRegistryContract.addFtso(accounts[15], {from: accounts[14]});
    // Assert
    await expectRevert(promise, ONLY_FTSO_MANAGER_MSG);

  });

  it("Should revert on non supported symbol removal", async() => {
    // Use different address
    const promise = ftsoRegistryContract.removeFtso("EUR", {from: MOCK_FTSO_ADDRESS});
    // Assert
    await expectRevert(promise, ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Should remove symbol", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    const BTCFtsoContractMock_2 = await mockFtso("BTC");
    const BTCFtsoContractMock_3 = await mockFtso("BTC");
    const XPRFtsoContractMock_1 = await mockFtso("XPR");
    const XPRFtsoContractMock_2 = await mockFtso("XPR");
    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock_2.address, {from: MOCK_FTSO_ADDRESS});
    
    const BTC_history = await ftsoRegistryContract.getFtsoHistory("BTC");
    const XPR_history = await ftsoRegistryContract.getFtsoHistory("XPR");
    const ADA_history = await ftsoRegistryContract.getFtsoHistory("ADA");
    
    assert.equal(BTC_history[0], BTCFtsoContractMock_3.address);
    assert.equal(BTC_history[1], BTCFtsoContractMock_2.address);
    assert.equal(BTC_history[2], BTCFtsoContractMock_1.address);
    assert.equal(BTC_history[3], constants.ZERO_ADDRESS);
    assert.equal(XPR_history[0], XPRFtsoContractMock_2.address);
    assert.equal(XPR_history[1], XPRFtsoContractMock_1.address);
    assert.equal(XPR_history[2], constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0], ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1], constants.ZERO_ADDRESS);
    // Act
    await ftsoRegistryContract.removeFtso("BTC", {from: MOCK_FTSO_ADDRESS});
    // Assert
    // Others should stay the same
    assert.equal(XPR_history[0], XPRFtsoContractMock_2.address);
    assert.equal(XPR_history[1], XPRFtsoContractMock_1.address);
    assert.equal(XPR_history[2], constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0], ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1], constants.ZERO_ADDRESS);

    const revertPromise = ftsoRegistryContract.getFtsoHistory("BTC");

    await expectRevert(revertPromise, ERR_TOKEN_NOT_SUPPORTED);

    const supported = await ftsoRegistryContract.getSupportedSymbols()
    assert.isFalse(supported.includes("BTC"));
    assert.isTrue(supported.includes("XPR"));
    assert.isTrue(supported.includes("ADA"));
  });

  it("Should not keep old history after reinsert", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    const BTCFtsoContractMock_2 = await mockFtso("BTC");
    const BTCFtsoContractMock_3 = await mockFtso("BTC");
    const XPRFtsoContractMock_1 = await mockFtso("XPR");
    const XPRFtsoContractMock_2 = await mockFtso("XPR");
    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.addFtso(XPRFtsoContractMock_2.address, {from: MOCK_FTSO_ADDRESS});
    
    const XPR_history = await ftsoRegistryContract.getFtsoHistory("XPR");
    const ADA_history = await ftsoRegistryContract.getFtsoHistory("ADA");
    
    // Act
    await ftsoRegistryContract.removeFtso("BTC", {from: MOCK_FTSO_ADDRESS});
    // Assert
    // Others should stay the same
    assert.equal(XPR_history[0], XPRFtsoContractMock_2.address);
    assert.equal(XPR_history[1], XPRFtsoContractMock_1.address);
    assert.equal(XPR_history[2], constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0], ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1], constants.ZERO_ADDRESS);

    const supported = await ftsoRegistryContract.getSupportedSymbols()
    assert.isFalse(supported.includes("BTC"));
    assert.isTrue(supported.includes("XPR"));
    assert.isTrue(supported.includes("ADA"));
    // Reinsert
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_ADDRESS});
    const BTC_history = await ftsoRegistryContract.getFtsoHistory("BTC");
    assert.equal(BTC_history[0], BTCFtsoContractMock_3.address);
    assert.equal(BTC_history[1], constants.ZERO_ADDRESS);
  });

  it("Should error on duplicate remove", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_ADDRESS});
    await ftsoRegistryContract.removeFtso("BTC", {from: MOCK_FTSO_ADDRESS});

    // Act 
    const revertPromise = ftsoRegistryContract.removeFtso("BTC", {from: MOCK_FTSO_ADDRESS});
    // Assert
    await expectRevert(revertPromise, ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Should error on removing unsupported symbol", async() => {
    // Assemble
    // Act 
    const revertPromise = ftsoRegistryContract.removeFtso("BTC", {from: MOCK_FTSO_ADDRESS});
    // Assert
    await expectRevert(revertPromise, ERR_TOKEN_NOT_SUPPORTED);
  });

});
