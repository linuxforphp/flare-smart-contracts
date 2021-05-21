import { 
  FtsoInflationAccountingInstance,
  FtsoInflationAuthorizerInstance, 
  MockContractInstance } from "../../../typechain-truffle";

const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting");
const MockContract = artifacts.require("MockContract");
const FtsoInflationAuthorizer = artifacts.require("FtsoInflationAuthorizer");

const BN = web3.utils.toBN;

contract(`FtsoInflationAuthorizer.sol; ${getTestFile(__filename)}; Ftso inflation authorizer unit tests`, async accounts => {
    // contains a fresh contract for each test
    let mockFtsoInflationAccounting: MockContractInstance;
    let mockInflationPercentageProvider: MockContractInstance;
    let mockSupplyAccounting: MockContractInstance;
    let ftsoInflationAccountingInterface: FtsoInflationAccountingInstance;
    let inflation: FtsoInflationAuthorizerInstance;
    let startTs: BN;

    beforeEach(async() => {
        mockFtsoInflationAccounting = await MockContract.new();
        mockInflationPercentageProvider = await MockContract.new();
        mockSupplyAccounting = await MockContract.new();

        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        const getInflatableSupplyBalance = web3.utils.sha3("getInflatableSupplyBalance()")!.slice(0,10); // first 4 bytes is function selector
        const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0,10);
        await mockSupplyAccounting.givenMethodReturnUint(getInflatableSupplyBalance, 1000000);
        await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, 1000);

        inflation = await FtsoInflationAuthorizer.new(
            accounts[0],
            3600,
            0,
            mockInflationPercentageProvider.address,
            mockSupplyAccounting.address,
            mockFtsoInflationAccounting.address
        );

        ftsoInflationAccountingInterface = await FtsoInflationAccounting.new(
          accounts[0], 
          (await MockContract.new()).address);
    });

    it("Should init annum inflation amount", async() => {
        // Assemble
        // Act
        await inflation.keep();
        // Assert
        const { 0: inflationToAllocateTWei } = await inflation.inflationAnnums(0) as any;
        assert.equal(inflationToAllocateTWei, 100000);
    });

    it("Should post expected inflation at start of annum", async() => {
        // Assemble
        const inflateForAnnum = ftsoInflationAccountingInterface.contract.methods.inflateForAnnum(BN(100000)).encodeABI();
        // Act
        await inflation.keep();
        // Assert
        const invocationCount = await mockFtsoInflationAccounting.invocationCountForCalldata.call(inflateForAnnum);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should calculate days in annum", async() => {
      // Assemble
      // Assume blockchain start time is 1/1/2021 - not a leap year
      // Act
      await inflation.keep();
      // Assert
      const { 1: daysInAnnum } = await inflation.inflationAnnums(0) as any;
      assert.equal(daysInAnnum, 365);
    });

    // TODO: Test start and end dates.

    // TODO: Test that annum rolls at the appropriate time.

    // TODO: Test periodic authorization
});