import { InflationAllocationInstance } from "../../../typechain-truffle";

const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const InflationAllocation = artifacts.require("InflationAllocation");
const MockContract = artifacts.require("MockContract");

const BN = web3.utils.toBN;

const ERR_OUT_OF_BOUNDS = "annual inflation out of bounds";
const ERR_TOO_MANY = "too many";
const ERR_NOT_100_PCT = "sum sharing percentage not 100%";
const ERR_ONLY_GOVERNANCE = "only governance";
const ERR_ONLY_INFLATION = "only inflation";
const ERR_ZERO_ADDRESS = "address is 0";
const ERR_LENGTH_MISMATCH = "length mismatch";

contract(`InflationAllocation.sol; ${getTestFile(__filename)}; InflationAllocation unit tests`, async accounts => {
  // contains a fresh contract for each test
  let inflationAllocation: InflationAllocationInstance;

  describe("initialization", async() => {      
    it("Should not accept an initial percentage greater than max", async() => {
      // Assemble
      // Act
      const promise = InflationAllocation.new(accounts[0], accounts[0], 1001);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });

    it("Should require initial percentage greater than 0", async() => {
      // Assemble
      // Act
      const promise = InflationAllocation.new(accounts[0], accounts[0], 0);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });
  });

  describe("annual inflation percentage schedule", async() => {
    beforeEach(async() => {
      inflationAllocation = await InflationAllocation.new(accounts[0], accounts[0], 1000);
    });
    
    it("Should get the initial annual percentage if no schedule", async() => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.getAnnualPercentageBips.call();
      // Assert
      assert.equal(percentage.toNumber(), 1000);
    });

    it("Should not get the initial annual percentage if not from inflation", async() => {
      // Assemble
      // Act
      const promise = inflationAllocation.getAnnualPercentageBips({from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ONLY_INFLATION);
    });

    it("Should accept an inflation percentage schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      // Act
      await inflationAllocation.setAnnualInflation(schedule);
      // Assert
      const percentage0 = await inflationAllocation.annualInflationPercentagesBips(0);
      const percentage1 = await inflationAllocation.annualInflationPercentagesBips(1);
      const percentage2 = await inflationAllocation.annualInflationPercentagesBips(2);
      assert.equal(percentage0.toNumber(), 1000);
      assert.equal(percentage1.toNumber(), 900);
      assert.equal(percentage2.toNumber(), 800);
    });

    it("Should yield each inflation percentage from schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(1000), BN(900), BN(800)];
      await inflationAllocation.setAnnualInflation(schedule);
      // Act
      let percentage = await inflationAllocation.getAnnualPercentageBips.call();
      await inflationAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 1000);
      // Act
      percentage = await inflationAllocation.getAnnualPercentageBips.call();
      await inflationAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 900);
      // Act
      percentage = await inflationAllocation.getAnnualPercentageBips.call();
      await inflationAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 800);
      // Act
      percentage = await inflationAllocation.getAnnualPercentageBips.call();
      await inflationAllocation.getAnnualPercentageBips();
      // Assert
      assert.equal(percentage.toNumber(), 800);
    });

    it("Should not take a schedule with a higher percentage than last given", async() => {
      // Assemble
      const schedule: BN[] = [BN(1001)];
      // Act
      const promise = inflationAllocation.setAnnualInflation(schedule);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);        
    });

    it("Should not take a schedule with an embeded higher percentage", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800), BN(900)];
      // Act
      const promise = inflationAllocation.setAnnualInflation(schedule);
      // Assert
      await expectRevert(promise, ERR_OUT_OF_BOUNDS);
    });

    it("Should not take a schedule count more than max allowed", async() => {
      // Assemble
      const schedule: BN[] = [BN(999), BN(998), BN(997), BN(996), BN(995), BN(994), BN(993), BN(992), BN(991), BN(990), BN(989)];
      // Act
      const promise = inflationAllocation.setAnnualInflation(schedule);
      // Assert
      await expectRevert(promise, ERR_TOO_MANY);
    });

    it("Should make available last inflation percentage yielded from schedule", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800)];
      await inflationAllocation.setAnnualInflation(schedule);
      // Act
      await inflationAllocation.getAnnualPercentageBips();
      // Assert
      const percentage = await inflationAllocation.lastAnnualInflationPercentageBips();
      assert.equal(percentage.toNumber(), 900);
    });

    it("Should take a schedule with no percents and yield last percentage given", async() => {
      // Assemble
      const schedule: BN[] = [BN(900), BN(800)];
      await inflationAllocation.setAnnualInflation(schedule);
      await inflationAllocation.getAnnualPercentageBips();
      // Act
      const newSchedule: BN[] = [];
      await inflationAllocation.setAnnualInflation(schedule);
      // Assert
      const percentage = await inflationAllocation.lastAnnualInflationPercentageBips();
      assert.equal(percentage.toNumber(), 900);
    });
  });

  describe("sharing percentages", async() => {
    beforeEach(async() => {
      inflationAllocation = await InflationAllocation.new(accounts[0], accounts[0], 1000);
    });

    it("Should require sharing percentages to sum to 100%", async() => {
      // Assemble
      const inflationReceivers: string[] = [];
      const percentages: BN[] = [];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_NOT_100_PCT);
    });

    it("Should not allow zero address inflation receiver contracts", async() => {
      // Assemble
      const inflationReceivers: string[] = [constants.ZERO_ADDRESS];
      const percentages: BN[] = [BN(10000)];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_ZERO_ADDRESS);
    });

    it("Should not set sharing percentages if not from governance", async() => {
      // Assemble
      const inflationReceivers: string[] = [];
      const percentages: BN[] = [];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages, {from: accounts[1]});
      // Assert
      await expectRevert(promise, ERR_ONLY_GOVERNANCE);
    });

    it("Should set sharing percentages", async() => {
      // Assemble
      const inflationReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(8000), BN(2000)];
      // Act
      await inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      const sharingPercentages = await inflationAllocation.getSharingPercentages();
      assert.equal(sharingPercentages[0].inflationReceiver, inflationReceivers[0]);
      assert.equal(sharingPercentages[0].percentBips as any, percentages[0].toString());
      assert.equal(sharingPercentages[1].inflationReceiver, inflationReceivers[1]);
      assert.equal(sharingPercentages[1].percentBips as any, percentages[1].toString());
    });

    it("Should not set sharing percentages if array lengths do not match", async() => {
      // Assemble
      const inflationReceivers: string[] = [(await MockContract.new()).address, (await MockContract.new()).address];
      const percentages: BN[] = [BN(8000), BN(1000), BN(1000)];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_LENGTH_MISMATCH);
    });

    it("Should not set sharing percentages if too many", async() => {
      // Assemble
      const inflationReceivers: string[] = [
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address, 
        (await MockContract.new()).address
      ];
      const percentages: BN[] = [
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(1000), 
        BN(500), 
        BN(500)];
      // Act
      const promise = inflationAllocation.setSharingPercentages(inflationReceivers, percentages);
      // Assert
      await expectRevert(promise, ERR_TOO_MANY);
    });
  });
});
