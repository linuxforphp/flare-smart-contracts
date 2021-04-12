import { DummyFAssetMinterContract, 
  DummyFAssetMinterInstance, 
  FAssetTokenContract,
  FAssetTokenInstance,
  MockContractContract, 
  MockContractInstance } from "../../../typechain-truffle";
const { constants, expectRevert } = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const DummyFAssetMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
const FAssetToken = artifacts.require("FAssetToken") as FAssetTokenContract;
const MockFAssetToken = artifacts.require("MockContract") as MockContractContract;

const MAX_EXCEEDED_MSG = "max exceeded";

contract(`DummyFAssetMinter.sol; ${getTestFile(__filename)}; Dummy FAsset minter unit tests`, async accounts => {
  // contains a fresh contract for each test
  let dummyFAssetMinter: DummyFAssetMinterInstance;
  let fassetTokenInterface: FAssetTokenInstance;
  let mockFAssetToken: MockContractInstance;

  beforeEach(async() => {
    mockFAssetToken = await MockFAssetToken.new();
    fassetTokenInterface = await FAssetToken.new(constants.ZERO_ADDRESS, "A Token", "ATOK");
    dummyFAssetMinter = await DummyFAssetMinter.new(mockFAssetToken.address, 1000);
  });

  it("Should delegate minting", async() => {
    // Assemble
    const mint = fassetTokenInterface.contract.methods.mint(constants.ZERO_ADDRESS, 0).encodeABI();
    // Act
    await dummyFAssetMinter.mintRequest(10, accounts[1], constants.ZERO_ADDRESS);
    // Assert
    const invocationCount = await mockFAssetToken.invocationCountForMethod.call(mint);
    assert.equal(invocationCount.toNumber(), 1);
  });

  it("Should limit mint request amounts", async() => {
    // Assemble
    // Act
    let promise = dummyFAssetMinter.mintRequest(1001, accounts[1], constants.ZERO_ADDRESS);
    // Assert
    await expectRevert(promise, MAX_EXCEEDED_MSG);
  });  
});