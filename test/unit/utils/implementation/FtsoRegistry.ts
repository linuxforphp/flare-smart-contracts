
import { constants, expectRevert } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import { FtsoRegistryInstance } from '../../../../typechain-truffle';
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
import { encodeContractNames } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;
const MockFtso = artifacts.require("MockFtso");
const FtsoRegistryContract = artifacts.require("FtsoRegistry");
const MockContract = artifacts.require("MockContract");


const ONLY_ADDRESS_UPDATER_MSG = "only address updater";
const ONLY_FTSO_MANAGER_MSG = "FTSO manager only";
const ERR_TOKEN_NOT_SUPPORTED = "FTSO index not supported";

let MOCK_FTSO_MANAGER_ADDRESS: string;

async function mockFtso(symbol: string){
  return await MockFtso.new(symbol, 5, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, MOCK_FTSO_MANAGER_ADDRESS, 0, 0, 0, 0, 0, defaultPriceEpochCyclicBufferSize, false);
}


contract(`FtsoRegistry.sol; ${getTestFile(__filename)}; FtsoRegistry contract unit tests`, async accounts => {
  let ftsoRegistryContract: FtsoRegistryInstance;
  const GOVERNANCE_ADDRESS = accounts[0];
  const ADDRESS_UPDATER = accounts[16];
  MOCK_FTSO_MANAGER_ADDRESS = accounts[123];

  beforeEach(async() => {
    ftsoRegistryContract = await FtsoRegistryContract.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER);
    
    await ftsoRegistryContract.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, MOCK_FTSO_MANAGER_ADDRESS], {from: ADDRESS_UPDATER});
  });

  it("Should revert for unsupported index ", async() => {
    // Assemble
    const unnsupported_token_promise = ftsoRegistryContract.getFtso(1);
    // Act
  
    // Assert
    await expectRevert(unnsupported_token_promise, ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Should add new symbol to registry ", async() => {
    // Assemble
    let BTC_FTSO_promise = ftsoRegistryContract.getFtso(0);
    await expectRevert(BTC_FTSO_promise, ERR_TOKEN_NOT_SUPPORTED);
    // Act
    let BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    const BTC_FTSO_address = await ftsoRegistryContract.getFtso(await ftsoRegistryContract.getFtsoIndex("BTC"));
    // Assert
    assert.equal(BTC_FTSO_address, BTCFtsoContractMock.address);
  });

  it("Should get correct symbol for index", async() => {
    // Assemble
    let BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    let XRPFtsoContractMock = await mockFtso("XRP");
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Act
    const BTC_SYMBOL = await ftsoRegistryContract.getFtsoSymbol(0);
    // Assert
    assert.equal(BTC_SYMBOL, await BTCFtsoContractMock.symbol());
  });

  it("Should get correct index with hole", async() => {
    // Assemble
    const btcMock = await mockFtso("BTC");
    const ltcMock = await mockFtso("LTC");

    await ftsoRegistryContract.addFtso(btcMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ltcMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    // Act
    const btcIndex = await ftsoRegistryContract.getFtsoIndex("BTC");
    const ltcIndex = await ftsoRegistryContract.getFtsoIndex("LTC");

    assert.isTrue(btcIndex.eqn(0));
    assert.isTrue(ltcIndex.eqn(1));

    await ftsoRegistryContract.removeFtso(btcMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    await expectRevert(ftsoRegistryContract.getFtsoIndex("BTC"), ERR_TOKEN_NOT_SUPPORTED);
    const ltcIndex2 = await ftsoRegistryContract.getFtsoIndex("LTC");
    assert.isTrue(ltcIndex.eq(ltcIndex2));

    await expectRevert(ftsoRegistryContract.getFtsos([0]), ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Should get current price by index", async() => {
    // Assemble
    let BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    let XRPFtsoContractMock = await mockFtso("XRP");
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    await XRPFtsoContractMock.updateInitialPrice(1256, 256, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Act
    const {0: price, 1: timestamp } = await ftsoRegistryContract.methods["getCurrentPrice(uint256)"](1);
    const {0: price2, 1: timestamp2, 2: decimals2 } = await ftsoRegistryContract.methods["getCurrentPriceWithDecimals(uint256)"](1);
    // Assert
    assert.equal(price.toString(), "1256");
    assert.equal(timestamp.toString(), "256");

    assert.equal(price2.toString(), "1256");
    assert.equal(timestamp2.toString(), "256");
    assert.equal(decimals2.toString(), "5");
  });

  it("Should get current price by symbol", async() => {
    // Assemble
    let BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    let XRPFtsoContractMock = await mockFtso("XRP");
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    await XRPFtsoContractMock.updateInitialPrice(1256, 256, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Act
    const {0: price, 1: timestamp } = await ftsoRegistryContract.methods["getCurrentPrice(string)"]("XRP");
    const {0: price2, 1: timestamp2, 2: decimals2 } = await ftsoRegistryContract.methods["getCurrentPriceWithDecimals(string)"]("XRP");
    // Assert
    assert.equal(price.toString(), "1256");
    assert.equal(timestamp.toString(), "256");

    assert.equal(price2.toString(), "1256");
    assert.equal(timestamp2.toString(), "256");
    assert.equal(decimals2.toString(), "5");
  });

  it("Should get all supported tokens ", async() => {
    // Assemble
    const supported_indices = await ftsoRegistryContract.getSupportedIndices();
    assert.equal(supported_indices.length, 0);
    // Act
    let BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    const [btcIndex] = await ftsoRegistryContract.getSupportedIndices();
    // Assert
    assert.isTrue(btcIndex.eqn(0));
  });

  it("Should update the address of existing active Ftso contract ", async() => {
    // Assemble
    const BTCFtsoContractMock = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    const BTC_FTSO_address = await ftsoRegistryContract.getFtso(await ftsoRegistryContract.getFtsoIndex("BTC"));
    assert.equal(BTC_FTSO_address, BTCFtsoContractMock.address);
    // Act
    const newBTCFtsoContractMock = await mockFtso("BTC");
    const XRPFtsoContractMock = await mockFtso("XRP");
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(newBTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    const {0: [ind1, ind2], 1: [f1, f2]} = await ftsoRegistryContract.getSupportedIndicesAndFtsos();
    const new_BTC_FTSO = await ftsoRegistryContract.getFtso(await ftsoRegistryContract.getFtsoIndex("BTC"));
    const XRP_FTSO = await ftsoRegistryContract.getFtso(await ftsoRegistryContract.getFtsoIndex("XRP"));
    // Assert
    assert.isTrue(ind1.eqn(0));
    assert.isTrue(ind2.eqn(1));
    assert.equal(f1, newBTCFtsoContractMock.address);
    assert.equal(f2, XRPFtsoContractMock.address);
    assert.equal(new_BTC_FTSO, newBTCFtsoContractMock.address);
    assert.equal(XRP_FTSO, XRPFtsoContractMock.address);
  });

  it("Should record history ", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    const BTCFtsoContractMock_2 = await mockFtso("BTC");
    const BTCFtsoContractMock_3 = await mockFtso("BTC");
    const XRPFtsoContractMock_1 = await mockFtso("XRP");
    const XRPFtsoContractMock_2 = await mockFtso("XRP");
    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Act
    const BTC_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("BTC"));
    const XRP_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("XRP"));
    const ADA_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("ADA"));
    // Assert
    assert.equal(BTC_history[0],BTCFtsoContractMock_3.address);
    assert.equal(BTC_history[1],BTCFtsoContractMock_2.address);
    assert.equal(BTC_history[2],BTCFtsoContractMock_1.address);
    assert.equal(BTC_history[3],constants.ZERO_ADDRESS);
    assert.equal(XRP_history[0],XRPFtsoContractMock_2.address);
    assert.equal(XRP_history[1],XRPFtsoContractMock_1.address);
    assert.equal(XRP_history[2],constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0],ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1],constants.ZERO_ADDRESS);
  });

  it("Should revert on invalid history index", async() => {
    const BTCFtsoContractMock_1 = await mockFtso("BTC");

    const XRPFtsoContractMock_1 = await mockFtso("XRP");
    
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});


    // Act
    const BTC_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("BTC"));
    const XRP_historyPromise = ftsoRegistryContract.getFtsoHistory(1);

    await expectRevert(XRP_historyPromise, ERR_TOKEN_NOT_SUPPORTED);

    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    const XRP_history = await ftsoRegistryContract.getFtsoHistory(1);
    // Assert
    assert.equal(BTC_history[0],BTCFtsoContractMock_1.address);
    
    assert.equal(XRP_history[0],XRPFtsoContractMock_1.address);

  });

  it("Should get all supported tokens and their addresses ", async() => {
    // Assemble
    let BTCFtsoContractMock = await mockFtso("BTC");
    let XRPFtsoContractMock = await mockFtso("XRP");
    let ADAFtsoContractMock = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Act
    const {
      0: indices,
      1: addresses
    } = await ftsoRegistryContract.getSupportedIndicesAndFtsos();
    // Assert
    assert.equal(indices.length, 3);
    assert.equal(indices[0].toNumber(), 0);
    assert.equal(indices[1].toNumber(), 1);
    assert.equal(indices[2].toNumber(), 2);
    assert.equal(addresses.length, 3);
    assert.equal(addresses[0],BTCFtsoContractMock.address);
    assert.equal(addresses[1],XRPFtsoContractMock.address);
    assert.equal(addresses[2],ADAFtsoContractMock.address);
  });

  it("Should not allow to change ftso manager if not address updater", async() => {
    // Assemble
    const mockFtsoManager = await MockContract.new();
    // Act
    let promise = ftsoRegistryContract.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, MOCK_FTSO_MANAGER_ADDRESS], {from: accounts[1]});
    // Assert
    await expectRevert(promise, ONLY_ADDRESS_UPDATER_MSG);

  });

  it("Should not allow non Ftso manager address to add ftso", async() => {
    // Assemble

    // Act
    await ftsoRegistryContract.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, accounts[15]], {from: ADDRESS_UPDATER});
    // Use different address
    const promise = ftsoRegistryContract.addFtso(accounts[15], {from: accounts[14]});
    // Assert
    await expectRevert(promise, ONLY_FTSO_MANAGER_MSG);

  });

  it("Should revert on non supported symbol removal", async() => {
    // Use different address

    const promise = ftsoRegistryContract.removeFtso((await mockFtso("NO_TOKEN")).address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Assert
    await expectRevert(promise, ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Should remove non-first", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    const BTCFtsoContractMock_2 = await mockFtso("BTC");
    const BTCFtsoContractMock_3 = await mockFtso("BTC");
    const XRPFtsoContractMock_1 = await mockFtso("XRP");
    const XRPFtsoContractMock_2 = await mockFtso("XRP");
    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    await ftsoRegistryContract.removeFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    await expectRevert(ftsoRegistryContract.getFtsoIndex("ADA"), ERR_TOKEN_NOT_SUPPORTED);
    await expectRevert(ftsoRegistryContract.getFtso(2), ERR_TOKEN_NOT_SUPPORTED);

    assert.isTrue((await ftsoRegistryContract.getFtsoIndex("BTC")).eqn(0));

  });

  it("Should remove symbol", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    const BTCFtsoContractMock_2 = await mockFtso("BTC");
    const BTCFtsoContractMock_3 = await mockFtso("BTC");
    const XRPFtsoContractMock_1 = await mockFtso("XRP");
    const XRPFtsoContractMock_2 = await mockFtso("XRP");
    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    
    const BTC_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("BTC"));
    const XRP_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("XRP"));
    const ADA_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("ADA"));
    
    assert.equal(BTC_history[0], BTCFtsoContractMock_3.address);
    assert.equal(BTC_history[1], BTCFtsoContractMock_2.address);
    assert.equal(BTC_history[2], BTCFtsoContractMock_1.address);
    assert.equal(BTC_history[3], constants.ZERO_ADDRESS);
    assert.equal(XRP_history[0], XRPFtsoContractMock_2.address);
    assert.equal(XRP_history[1], XRPFtsoContractMock_1.address);
    assert.equal(XRP_history[2], constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0], ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1], constants.ZERO_ADDRESS);
    // Act
    await ftsoRegistryContract.removeFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Assert
    // Others should stay the same
    assert.equal(XRP_history[0], XRPFtsoContractMock_2.address);
    assert.equal(XRP_history[1], XRPFtsoContractMock_1.address);
    assert.equal(XRP_history[2], constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0], ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1], constants.ZERO_ADDRESS);

    const revertPromise = ftsoRegistryContract.getFtsoIndex("BTC");

    await expectRevert(revertPromise, ERR_TOKEN_NOT_SUPPORTED);
    
    const revertPromiseGet = ftsoRegistryContract.getFtso(0);

    await expectRevert(revertPromiseGet, ERR_TOKEN_NOT_SUPPORTED);

    const [s1, s2] = await ftsoRegistryContract.getSupportedIndices();
    
    assert.isTrue(s1.eqn(1));
    assert.isTrue(s2.eqn(2));

    const [f1, f2, f3] = await ftsoRegistryContract.getAllFtsos();
    assert.equal(f1, constants.ZERO_ADDRESS);
    assert.equal(f2, XRPFtsoContractMock_2.address);
    assert.equal(f3, ADAFtsoContractMock_1.address);

    const {
      0: [sy1, sy2],
      1: [ft1, ft2],
    } = await ftsoRegistryContract.getSupportedSymbolsAndFtsos();

    assert.equal(sy1, "XRP");
    assert.equal(sy2, "ADA");
    assert.equal(ft1, XRPFtsoContractMock_2.address);
    assert.equal(ft2, ADAFtsoContractMock_1.address);
  });

  it("Should not keep old history after reinsert", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    const BTCFtsoContractMock_2 = await mockFtso("BTC");
    const BTCFtsoContractMock_3 = await mockFtso("BTC");
    const XRPFtsoContractMock_1 = await mockFtso("XRP");
    const XRPFtsoContractMock_2 = await mockFtso("XRP");
    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    
    const XRP_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("XRP"));
    const ADA_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("ADA"));
    
    // Act
    await ftsoRegistryContract.removeFtso(BTCFtsoContractMock_2.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Assert
    // Others should stay the same
    assert.equal(XRP_history[0], XRPFtsoContractMock_2.address);
    assert.equal(XRP_history[1], XRPFtsoContractMock_1.address);
    assert.equal(XRP_history[2], constants.ZERO_ADDRESS);
    assert.equal(ADA_history[0], ADAFtsoContractMock_1.address);
    assert.equal(ADA_history[1], constants.ZERO_ADDRESS);

    const [i1, i2] = await ftsoRegistryContract.getSupportedIndices();

    assert.isTrue(i1.eqn(1));
    assert.isTrue(i2.eqn(2));
    // Reinsert
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_3.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    const BTC_history = await ftsoRegistryContract.getFtsoHistory(await ftsoRegistryContract.getFtsoIndex("BTC"));
    assert.equal(BTC_history[0], BTCFtsoContractMock_3.address);
    assert.equal(BTC_history[1], constants.ZERO_ADDRESS);
  });

  it("Should correctly return supported indices", async() => {
    const BTCFtsoContractMock_1 = await mockFtso("BTC");

    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    let [supp] = await ftsoRegistryContract.getSupportedIndices();
    let [suppF] = await ftsoRegistryContract.getSupportedFtsos();
    await ftsoRegistryContract.removeFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    let supp0 = await ftsoRegistryContract.getSupportedIndices();
    let suppF0 = await ftsoRegistryContract.getSupportedFtsos();

    assert.isEmpty(supp0);
    assert.isEmpty(suppF0);

    const ADAFtsoContractMock_1 = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    [supp] = await ftsoRegistryContract.getSupportedIndices();
    [suppF] = await ftsoRegistryContract.getSupportedFtsos();
    await ftsoRegistryContract.removeFtso(ADAFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    supp0 = await ftsoRegistryContract.getSupportedIndices();
    suppF0 = await ftsoRegistryContract.getSupportedFtsos();

    assert.isEmpty(supp0);
    assert.isEmpty(suppF0);


  });

  it("Should error on duplicate remove", async() => {
    // Assemble
    const BTCFtsoContractMock_1 = await mockFtso("BTC");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    const [supp] = await ftsoRegistryContract.getSupportedIndices();
    const [suppF] = await ftsoRegistryContract.getSupportedFtsos();
    await ftsoRegistryContract.removeFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});

    // Act 
    const revertPromise = ftsoRegistryContract.removeFtso(BTCFtsoContractMock_1.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Assert
    await expectRevert(revertPromise, ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Should error on removing unsupported ftso", async() => {
    // Assemble
    const emptyFtso = await mockFtso("BTC");
    // Act 
   
    const revertPromise = ftsoRegistryContract.removeFtso(emptyFtso.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Assert
    await expectRevert(revertPromise, ERR_TOKEN_NOT_SUPPORTED);
  });

  it("Should get all supported indices and their symbols", async() => {
    // Assemble
    let BTCFtsoContractMock = await mockFtso("BTC");
    let XRPFtsoContractMock = await mockFtso("XRP");
    let ADAFtsoContractMock = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Act
    const {
      0: indices,
      1: symbols
    } = await ftsoRegistryContract.getSupportedIndicesAndSymbols();
    // Assert
    assert.equal(indices.length, 3);
    assert.equal(indices[0].toNumber(), 0);
    assert.equal(indices[1].toNumber(), 1);
    assert.equal(indices[2].toNumber(), 2);
    assert.equal(symbols.length, 3);
    assert.equal(symbols[0], "BTC");
    assert.equal(symbols[1], "XRP");
    assert.equal(symbols[2], "ADA");
  });

  it("Should get all supported indices, their symbols and addresses", async() => {
    // Assemble
    let BTCFtsoContractMock = await mockFtso("BTC");
    let XRPFtsoContractMock = await mockFtso("XRP");
    let ADAFtsoContractMock = await mockFtso("ADA");
    await ftsoRegistryContract.addFtso(BTCFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(XRPFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    await ftsoRegistryContract.addFtso(ADAFtsoContractMock.address, {from: MOCK_FTSO_MANAGER_ADDRESS});
    // Act
    const {
      0: indices,
      1: symbols,
      2: addresses
    } = await ftsoRegistryContract.getSupportedIndicesSymbolsAndFtsos();
    // Assert
    assert.equal(indices.length, 3);
    assert.equal(indices[0].toNumber(), 0);
    assert.equal(indices[1].toNumber(), 1);
    assert.equal(indices[2].toNumber(), 2);
    assert.equal(symbols.length, 3);
    assert.equal(symbols[0], "BTC");
    assert.equal(symbols[1], "XRP");
    assert.equal(symbols[2], "ADA");
    assert.equal(addresses.length, 3);
    assert.equal(addresses[0],BTCFtsoContractMock.address);
    assert.equal(addresses[1],XRPFtsoContractMock.address);
    assert.equal(addresses[2],ADAFtsoContractMock.address);
  });

});
