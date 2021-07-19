import { setDefaultVPContract } from "../../../utils/token-test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
import {constants, expectRevert, time} from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContract");

contract(`VPContract.sol; ${getTestFile(__filename)}; VPContract unit tests`, async accounts => {
  it("Should not create VPContract without owner", async () => {
    await expectRevert(VPContract.new(constants.ZERO_ADDRESS, false),
      "VPContract must belong to a VPToken");
  });

  it("Should not access VPContract mutable methods directly", async () => {
    // Assemble
    const vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    await setDefaultVPContract(vpToken, accounts[0]);
    const vpContractAddr = await vpToken.getWriteVpContract();
    const vpContract = await VPContract.at(vpContractAddr);
    // Act
    // Assert
    await expectRevert(vpContract.updateAtTokenTransfer(accounts[1], accounts[2], 500, 200, 250),
      "only owner token");
    await expectRevert(vpContract.delegate(accounts[1], accounts[2], 500, 2000),
      "only owner token");
    await expectRevert(vpContract.delegateExplicit(accounts[1], accounts[2], 500, 200),
      "only owner token");
    await expectRevert(vpContract.revokeDelegationAt(accounts[1], accounts[2], 500, 15),
      "only owner token");
    await expectRevert(vpContract.undelegateAll(accounts[1], 500),
      "only owner token");
    await expectRevert(vpContract.undelegateAllExplicit(accounts[1], [accounts[2], accounts[3]]),
      "only owner token");
  });
  
  it("Cleanup block/contract setters can only be called by owner token or its governance", async () => {
    // Assemble
    const vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    await setDefaultVPContract(vpToken, accounts[0]);
    const vpContractAddr = await vpToken.getWriteVpContract();
    const vpContract = await VPContract.at(vpContractAddr);
    // Act
    // Assert
    await expectRevert(vpContract.setCleanupBlockNumber(1, { from: accounts[1] }),
      "only owner, governance or cleanup block manager");
    await expectRevert(vpContract.setCleanerContract(accounts[3], { from: accounts[1] }),
      "only owner or governance");
    // there should be no revert when called via token
    await vpToken.setCleanupBlockNumber(1, { from: accounts[0] });
    await vpToken.setCleanerContract(accounts[3], { from: accounts[0] });
    // there should be no revert when called directly by token's governance
    await vpContract.setCleanupBlockNumber(1, { from: accounts[0] });
    await vpContract.setCleanerContract(accounts[3], { from: accounts[0] });
  });

  it("Cleanup block/contract setters can be called by governance when detached", async () => {
    // Assemble
    const vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
    await setDefaultVPContract(vpToken, accounts[0]);
    const vpContractAddr = await vpToken.getWriteVpContract();
    const vpContract = await VPContract.at(vpContractAddr);
    // Act
    // detach vpContract
    await vpToken.setWriteVpContract(constants.ZERO_ADDRESS, { from: accounts[0] });
    await vpToken.setReadVpContract(constants.ZERO_ADDRESS, { from: accounts[0] });
    // Assert
    // there should be no revert
    await vpContract.setCleanupBlockNumber(1);
    await vpContract.setCleanerContract(accounts[3]);
  });
});
