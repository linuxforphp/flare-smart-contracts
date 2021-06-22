import { setDefaultVPContract } from "../../utils/token-test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
const {constants, expectRevert, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

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
    const vpContractAddr = await vpToken.getVpContract();
    const vpContract = await VPContract.at(vpContractAddr);
    // Act
    // Assert
    await expectRevert(vpContract.updateAtTokenTransfer(accounts[1], accounts[2], 500, 200, 250),
      "Transaction reverted without a reason");
    await expectRevert(vpContract.delegate(accounts[1], accounts[2], 500, 2000),
      "Transaction reverted without a reason");
    await expectRevert(vpContract.delegateExplicit(accounts[1], accounts[2], 500, 200),
      "Transaction reverted without a reason");
    await expectRevert(vpContract.revokeDelegationAt(accounts[1], accounts[2], 500, 15),
      "Transaction reverted without a reason");
    await expectRevert(vpContract.undelegateAll(accounts[1], 500),
      "Transaction reverted without a reason");
    await expectRevert(vpContract.undelegateAllExplicit(accounts[1], [accounts[2], accounts[3]]),
      "Transaction reverted without a reason");
  });
});
