import { governanceAccounts, WORKING_BALANCE_WEI } from "../scripts/multisig-governance-accounts";

contract(`transfer-gov-working-balance.ts system tests`, async accounts => {
  describe("Multisig governance accounts balance check", async () => {
    it("Should have working balances", async () => {
      governanceAccounts.forEach(async (item, index) => {
        // Assemble
        // Act
        const balance = await web3.eth.getBalance(item);
        // Assert
        assert.equal(balance, WORKING_BALANCE_WEI.toString(), `Address ${item} does not have ${WORKING_BALANCE_WEI.toString()} wei.`);
      });
    });
  });
});