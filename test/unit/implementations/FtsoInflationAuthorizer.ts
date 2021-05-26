import { 
  FtsoInflationAccountingInstance,
  FtsoInflationAuthorizerInstance, 
  MockContractInstance } from "../../../typechain-truffle";

const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting");
const MockContract = artifacts.require("MockContract");
const FtsoInflationAuthorizer = artifacts.require("FtsoInflationAuthorizer");

const ERR_CLOSE_MANAGER_ONLY = "close manager only";    

const BN = web3.utils.toBN;

contract(`FtsoInflationAuthorizer.sol; ${getTestFile(__filename)}; Ftso inflation authorizer unit tests`, async accounts => {
    // contains a fresh contract for each test
    let mockFtsoInflationAccounting: MockContractInstance;
    let mockInflationPercentageProvider: MockContractInstance;
    let mockSupplyAccounting: MockContractInstance;
    let ftsoInflationAccountingInterface: FtsoInflationAccountingInstance;
    let inflation: FtsoInflationAuthorizerInstance;
    let startTs: BN;
    const supply = 1000000;
    const inflationBips = 1000;
    const inflationFactor = inflationBips / 10000;
    const authorizationFreqSec = 3600;
    const inflationForAnnum = supply * inflationFactor;

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
        await mockSupplyAccounting.givenMethodReturnUint(getInflatableSupplyBalance, supply);
        await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, inflationBips);

        inflation = await FtsoInflationAuthorizer.new(
            accounts[0],
            authorizationFreqSec,
            startTs,
            mockInflationPercentageProvider.address,
            mockSupplyAccounting.address,
            accounts[0],                              // Fake out modifier so we can call close() manually
            mockFtsoInflationAccounting.address,
        );

        ftsoInflationAccountingInterface = await FtsoInflationAccounting.new(
          accounts[0], 
          (await MockContract.new()).address);
    });

    describe("init", async() => {

      it("Should init annum inflation amount", async() => {
          // Assemble
          // Act
          await inflation.keep();
          // Assert
          const { 0: inflationToAllocateTWei } = await inflation.inflationAnnums(0) as any;
          assert.equal(inflationToAllocateTWei, inflationForAnnum);
      });

      it("Should post expected inflation at start of annum", async() => {
          // Assemble
          const inflateForAnnum = ftsoInflationAccountingInterface.contract.methods.inflateForAnnum(BN(inflationForAnnum)).encodeABI();
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
    });

    describe("authorize", async() => {
      it("Should set next authorization", async() => {
        // Assemble
        // Assume blockchain start time is 1/1/2021 - not a leap year
        // Act
        await inflation.keep();
        // Assert
        assert((await inflation.nextAuthorizationTs()).eq(startTs.addn(authorizationFreqSec)));
      });

      it("Should authorize inflation", async() => {
        // Assemble
        // Act
        await inflation.keep();
        // Assert
        const expected = Math.floor(inflationForAnnum * (authorizationFreqSec / (365 * 86400)));
        const {4:actual} = await inflation.inflationAnnums(await inflation.currentAnnum())
        assert.equal(actual.toNumber(), expected);
      });

      it("Should authorize inflation for 2 periods", async() => {
        // Assemble
        await inflation.keep();
        // Act
        // Time travel to the next period
        await time.increaseTo(startTs.addn(authorizationFreqSec));
        await inflation.keep();
        // Assert
        // Simulate double declining balance calculation
        const expectedFirst = Math.floor(inflationForAnnum * (authorizationFreqSec / (365 * 86400)));
        const expectedSecond = Math.floor((inflationForAnnum - expectedFirst) * (authorizationFreqSec / (364 * 86400)));
        const {4:actual} = await inflation.inflationAnnums(await inflation.currentAnnum());
        assert.equal(actual.toNumber(), expectedFirst + expectedSecond);
      });

      it("Should update accounting at authorize time", async() => {
        // Assemble
        // Act
        await inflation.keep();
        // Assert
        const expected = Math.floor(inflationForAnnum * (authorizationFreqSec / (365 * 86400)));
        const authorizeMinting = ftsoInflationAccountingInterface.contract.methods.authorizeMinting(BN(expected)).encodeABI();
        const invocationCount = await mockFtsoInflationAccounting.invocationCountForCalldata.call(authorizeMinting);
        assert.equal(invocationCount.toNumber(), 1);
      });
    });

    describe("close", async() => {
      it("Should claw back authorized inflation to only time that has elapsed", async() => {
        // Assemble
        await inflation.keep();
        // Time travel to middle of authorization period
        await time.increaseTo(startTs.addn(authorizationFreqSec / 2));
        // Act
        await inflation.close();
        // Assert
        const expected = Math.floor(inflationForAnnum * (authorizationFreqSec / (365 * 86400) / 2));
        const {4:actual} = await inflation.inflationAnnums(await inflation.currentAnnum());
        assert.equal(actual.toNumber(), expected);
      });

      it("Should only close from CloseManager", async() => {
        // Assemble
        // Act
        let closePromise = inflation.close({ from: accounts[1] });
        // Assert
        await expectRevert(closePromise, ERR_CLOSE_MANAGER_ONLY)
      });
    });


    // TODO: Test start and end dates.

    // TODO: Test that annum rolls at the appropriate time.

    // TODO: Test close more indepth
});
