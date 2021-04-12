import { DummyFAssetMinterContract, 
  DummyFAssetMinterInstance, 
  FAssetTokenContract,
  FAssetTokenInstance } from "../../../typechain-truffle";
const { constants, expectRevert } = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const DummyFAssetMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
const FAssetToken = artifacts.require("FAssetToken") as FAssetTokenContract;

contract(`DummyFAssetMinter.sol; ${getTestFile(__filename)}; Dummy FAsset minter integration tests`, async accounts => {
  // contains a fresh contract for each test
  let dummyFAssetMinter: DummyFAssetMinterInstance;
  let fassetToken: FAssetTokenInstance;

  beforeEach(async() => {
    fassetToken = await FAssetToken.new(accounts[1], "A Token", "ATOK");
    dummyFAssetMinter = await DummyFAssetMinter.new(fassetToken.address, 1000);
  });

  it("Should claim governance of token", async() => {
    // Assemble
    await fassetToken.proposeGovernance(dummyFAssetMinter.address, {from: accounts[1]});
    // Act
    await dummyFAssetMinter.claimGovernanceOverMintableToken();
    // Assert
    assert.equal(await fassetToken.governance(), dummyFAssetMinter.address);
  });

  it("Should delegate minting", async() => {
    // Assemble
    await fassetToken.proposeGovernance(dummyFAssetMinter.address, {from: accounts[1]});
    await dummyFAssetMinter.claimGovernanceOverMintableToken();
    // Act
    await dummyFAssetMinter.mintRequest(10, accounts[2], constants.ZERO_ADDRESS);
    // Assert
    let balance = await fassetToken.balanceOf(accounts[2]);
    assert.equal(balance.toNumber(), 10000);
  });
});