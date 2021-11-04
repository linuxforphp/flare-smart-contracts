
import { constants } from '@openzeppelin/test-helpers';
import { Ftso__factory } from '../../../../typechain';
import { FtsoRegistryInstance, MockContractInstance, PriceReaderInstance, AddressUpdaterInstance, MockFtsoInstance, FtsoInstance } from "../../../../typechain-truffle";
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
import { zipi, zip } from '../../../utils/test-helpers';
const { ethers } = require('hardhat');

const getTestFile = require('../../../utils/constants').getTestFile;
const MockFtso = artifacts.require("MockFtso");
const FtsoRegistryContract = artifacts.require("FtsoRegistry");
const AddressUpdaterContract = artifacts.require("AddressUpdater");
const MockContract = artifacts.require("MockContract");

const PriceReaderContract = artifacts.require("PriceReader");


contract(`FtsoRegistry.sol; ${getTestFile(__filename)}; FtsoRegistry contract unit tests`, async accounts => {
  let ftsoRegistryContract: FtsoRegistryInstance;
  let mockFtsoContract: MockContractInstance;
  let priceReader: PriceReaderInstance;
  let addressUpdater: AddressUpdaterInstance;
  const GOVERNANCE_ADDRESS = accounts[0];
  let ftsos: MockContractInstance[] = [];
  let dummyFtso: FtsoInstance;

  beforeEach(async() => {

    addressUpdater = await AddressUpdaterContract.new(GOVERNANCE_ADDRESS);

    ftsoRegistryContract = await FtsoRegistryContract.new(GOVERNANCE_ADDRESS);

    await ftsoRegistryContract.setFtsoManagerAddress(GOVERNANCE_ADDRESS, {from: GOVERNANCE_ADDRESS});

    mockFtsoContract = await MockContract.new();

    priceReader = await PriceReaderContract.new(GOVERNANCE_ADDRESS, ftsoRegistryContract.address);

    dummyFtso = await MockFtso.new(
      "",
      5,
      constants.ZERO_ADDRESS,
      constants.ZERO_ADDRESS,
      constants.ZERO_ADDRESS,
      0, 120, 60,
      1, // initial token price 0.00001$
      1e10,
      defaultPriceEpochCyclicBufferSize,
      false,
      1
    );

    const ftsoCreadedInstance = Ftso__factory.createInterface();
    const shash = ftsoCreadedInstance.getSighash(ftsoCreadedInstance.functions['symbol()'])

    const getPriceMethod2021 = dummyFtso.contract.methods.getEpochPrice(2021).encodeABI();
    const getPriceMethod2022 = dummyFtso.contract.methods.getEpochPrice(2022).encodeABI();
    const getRandomMethod2021 = dummyFtso.contract.methods.getRandom(2020).encodeABI();
    const getRandomMethod2022 = dummyFtso.contract.methods.getRandom(2021).encodeABI();
    const getCurrentEpochId = dummyFtso.contract.methods.getCurrentEpochId().encodeABI();

    let promises: Promise<any>[] = [];
    for(let i = 0; i < 10; i++){
      const ftso: any = await MockContract.new();

      promises = promises.concat([
        ftso.givenMethodReturn(shash, ethers.utils.defaultAbiCoder.encode(["string"], [`ATOK-${i}`])),
        ftso.givenCalldataReturnUint(getPriceMethod2021, 100 + i),
        ftso.givenCalldataReturnUint(getPriceMethod2022, 200 + i*2),
        ftso.givenCalldataReturnUint(getRandomMethod2021, 300 + i),
        ftso.givenCalldataReturnUint(getRandomMethod2022, 400 + i*2),
        ftso.givenCalldataReturnUint(getCurrentEpochId, 2022),
  
        ftsoRegistryContract.addFtso(ftso.address, {from: GOVERNANCE_ADDRESS}),
      ])

    }
    await Promise.all(promises);
    
  });

  it("Should get current prices", async() => {
    const allPrices2022 = await priceReader.getAllPrices(2022);
    const allPricesCurrent = await priceReader.getAllCurrentPrices();

    for(let [ind, ftso, [priceData, currentPriceData ]] of zipi(ftsos, zip(allPrices2022, allPricesCurrent))){
      assert.equal(priceData.price.toString(), `${200 + ind*2}`);
      assert.equal(currentPriceData.price.toString(), `${200 + ind*2}`);
      assert.equal(priceData.random.toString(), `${400 + ind*2}`);
      assert.equal(currentPriceData.random.toString(), `${400 + ind*2}`);
      assert.equal(priceData.ftsoAddress, ftso.address);
      assert.equal(currentPriceData.ftsoAddress, ftso.address);
      assert.equal(priceData.symbol, `ATOK-${ind}`);
      assert.equal(currentPriceData.symbol, `ATOK-${ind}`);
      assert.equal(priceData.ftsoIndex.toString(), `${ind}`);
      assert.equal(currentPriceData.ftsoIndex.toString(), `${ind}`);
    }

  });

  it("Should get old prices", async() => {
    const allPrices2021 = await priceReader.getAllPrices(2021);

    for(let [ind, ftso, priceData] of zipi(ftsos, allPrices2021)){
      assert.equal(priceData.price.toString(), `${100 + ind}`);
      assert.equal(priceData.random.toString(), `${300 + ind}`);
      assert.equal(priceData.ftsoAddress, ftso.address);
      assert.equal(priceData.symbol, `ATOK-${ind}`);
      assert.equal(priceData.ftsoIndex.toString(), `${ind}`);
    }

  });

  // Symbols
  it("Should get current prices by symbol", async() => {
    const indices = [1,4,7,3,5]
    const symbols = indices.map(i => `ATOK-${i}`);
    const allPrices2022 = await priceReader.getPricesBySymbols(2022, symbols);
    const allPricesCurrent = await priceReader.getCurrentPricesBySymbols(symbols);

    for(let [ind, [priceData, currentPriceData] ] of zip(indices, zip(allPrices2022, allPricesCurrent))){
      assert.equal(priceData.toString(), `${200 + ind*2}`);
      assert.equal(currentPriceData.toString(), `${200 + ind*2}`);
    }

  });

  it("Should get old prices by symbol", async() => {
    const indices = [1,4,7,3,5]
    const symbols = indices.map(i => `ATOK-${i}`);
    const allPrices2021 = await priceReader.getPricesBySymbols(2021, symbols);

    for(let [ind, priceData] of zip(indices, allPrices2021)){
      assert.equal(priceData.toString(), `${100 + ind}`);
    }

  });

  // indices
  it("Should get current prices by indices", async() => {
    const indices = [1,4,7,3,5]
    const allPrices2022 = await priceReader.getPricesByIndices(2022, indices);
    const allPricesCurrent = await priceReader.getCurrentPricesByIndices(indices);

    for(let [ind, [priceData, currentPriceData] ] of zip(indices, zip(allPrices2022, allPricesCurrent))){
      assert.equal(priceData.toString(), `${200 + ind*2}`);
      assert.equal(currentPriceData.toString(), `${200 + ind*2}`);
    }

  });

  it("Should get old prices by indices", async() => {
    const indices = [1,4,7,3,5]
    const allPrices2021 = await priceReader.getPricesByIndices(2021, indices);

    for(let [ind, priceData] of zip(indices, allPrices2021)){
      assert.equal(priceData.toString(), `${100 + ind}`);
    }

  });

  it("Should set FtsoRegistry address", async() => {
    const newFtsoRegistry = await FtsoRegistryContract.new(GOVERNANCE_ADDRESS);
    assert(newFtsoRegistry.address !== ftsoRegistryContract.address);

    await priceReader.setFtsoRegistry(newFtsoRegistry.address, {from: GOVERNANCE_ADDRESS});

    const newFtsoRegistryAddress = await priceReader.ftsoRegistry();

    assert(newFtsoRegistryAddress === newFtsoRegistry.address);

  });

});
