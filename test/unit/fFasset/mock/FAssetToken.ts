import { FAssetTokenContract, FAssetTokenInstance } from "../../../../typechain-truffle";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
const { expectRevert } = require('@openzeppelin/test-helpers');

const getTestFile = require('../../../utils/constants').getTestFile;

const FAssetToken = artifacts.require("FAssetToken") as FAssetTokenContract;

const ONLY_GOVERNANCE_MSG = "only governance";

contract(`FAssetToken.sol; ${getTestFile(__filename)}; FAsset token unit tests`, async accounts => {
  // contains a fresh contract for each test
  let fassetToken: FAssetTokenInstance;

  beforeEach(async() => {
    fassetToken = await FAssetToken.new(accounts[1], "A Token", "ATOK", 18);
    await setDefaultVPContract(fassetToken, accounts[1]);
  });

  it("Should not mint if not from governance", async() => {
    // Assemble
    // Act
    let promise = fassetToken.mint(accounts[2], 10);
    // Assert
    await expectRevert(promise, ONLY_GOVERNANCE_MSG);
  });

  it("Should not burn if not from governance", async() => {
    // Assemble
    await fassetToken.mint(accounts[2], 10, {from: accounts[1]});
    // Act
    let promise = fassetToken.burn(accounts[2], 10);
    // Assert
    await expectRevert(promise, ONLY_GOVERNANCE_MSG);
  });
  
  it("Should mint", async() => {
    // Assemble
    // Act
    await fassetToken.mint(accounts[2], 10, {from: accounts[1]});
    // Assert
    let balance = await fassetToken.balanceOf(accounts[2]);
    assert.equal(balance.toNumber(), 10);
  });

  it("Should burn", async() => {
    // Assemble
    await fassetToken.mint(accounts[2], 10, {from: accounts[1]});
    // Act
    await fassetToken.burn(accounts[2], 7, {from: accounts[1]});
    // Assert
    let balance = await fassetToken.balanceOf(accounts[2]);
    assert.equal(balance.toNumber(), 3);
  });

  it("Should set decimals", async() => {
    // Assemble
    const anotherFassetToken = await FAssetToken.new(accounts[1], "A Token", "ATOK", 6);
    await setDefaultVPContract(anotherFassetToken, accounts[1]);
    // Act
    const decimals = await anotherFassetToken.decimals();
    // Assert
    assert.equal(decimals.toNumber(), 6);
  });
});
