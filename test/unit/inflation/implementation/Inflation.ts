import { 
  FlareDaemonInstance,
  FlareDaemonMockInstance,
  InflationInstance,
  InflationReceiverMockInstance,
  MockContractInstance, BokkyPooBahsDateTimeContractInstance } from "../../../../typechain-truffle";

import {constants, expectRevert, expectEvent, time} from '@openzeppelin/test-helpers';
import { toBN } from "../../../utils/test-helpers";
const getTestFile = require('../../../utils/constants').getTestFile;

const Inflation = artifacts.require("Inflation");
const MockContract = artifacts.require("MockContract");
const SharingPercentageProviderMock = artifacts.require("SharingPercentageProviderMock");
const InflationReceiverMock = artifacts.require("InflationReceiverMock");
const FlareDaemonMock = artifacts.require("FlareDaemonMock");
const FlareDaemon = artifacts.require("FlareDaemon");
const SuicidalMock = artifacts.require("SuicidalMock");

// This library has a lot of unit tests, so it seems, that we should be able to use it for 
// timestamp conversion
const DateTimeContract = artifacts.require("BokkyPooBahsDateTimeContract");

const ERR_TOPUP_LOW = "topup low";
const ONLY_GOVERNANCE_MSG = "only governance";
const ERR_IS_ZERO = "address is 0";

const INFLATIONRECOGNIZED_EVENT = "InflationRecognized";
const INFLATIONAUTHORIZED_EVENT = "InflationAuthorized";
const TOPUPREQUESTED_EVENT = "TopupRequested";
const REWARDSERVICETOPUPCOMPUTED_EVENT = "RewardServiceTopupComputed";
const REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT = "RewardServiceDailyAuthorizedInflationComputed";
const SUPPLYSET_EVENT = "SupplySet";
const MINTINGRECEIVED_EVENT = "MintingReceived";
const REWARDSERVICETOPUPREQUESTRECEIVED_EVENT = "RewardServiceTopupRequestReceived";

enum TopupType{ FACTOROFDAILYAUTHORIZED, ALLAUTHORIZED }

const DEFAULT_TOPUP_FACTOR_X100 = 120;

const BN = web3.utils.toBN;

contract(`Inflation.sol; ${getTestFile(__filename)}; Inflation unit tests`, async accounts => {
    // contains a fresh contract for each test
    let mockInflationPercentageProvider: MockContractInstance;
    let mockSupply: MockContractInstance;
    let mockInflationSharingPercentageProvider: MockContractInstance;
    let inflation: InflationInstance;
    let mockInflationReceiverInterface: InflationReceiverMockInstance;
    let mockFlareDaemon: FlareDaemonMockInstance;
    let mockFlareDaemonInterface: FlareDaemonInstance;
    let startTs: BN;
    let dateTimeContract: BokkyPooBahsDateTimeContractInstance;
    const supply = 1000000;
    const inflationBips = 1000;
    const inflationFactor = inflationBips / 10000;
    const inflationForAnnum = supply * inflationFactor;

    beforeEach(async() => {
        mockSupply = await MockContract.new();
        mockInflationPercentageProvider = await MockContract.new();
        mockInflationSharingPercentageProvider = await MockContract.new();
        mockInflationReceiverInterface = await InflationReceiverMock.new();
        mockFlareDaemon = await FlareDaemonMock.new();
        mockFlareDaemonInterface = await FlareDaemon.new();
        dateTimeContract = await DateTimeContract.new()
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0,10); // first 4 bytes is function selector
        const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0,10);
        await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
        await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, inflationBips);

        inflation = await Inflation.new(
            accounts[0],
            mockFlareDaemon.address,
            mockInflationPercentageProvider.address,
            mockInflationSharingPercentageProvider.address,
            0
        );
        await inflation.setSupply(mockSupply.address);
        await mockFlareDaemon.registerToDaemonize(inflation.address);
    });

    describe("init", async() => {
      it("Should sum recognized inflation", async() => {
          // Assemble
          // Act
          await mockFlareDaemon.trigger();
          // Assert
          const {4: recognizedInflation} = await inflation.getTotals();
          assert.equal(recognizedInflation.toNumber(), inflationForAnnum);
      });

      it("Should initialize the annum", async() => {
        // Assemble
        // Assume blockchain start time is 1/1/2021 - not a leap year
        // Act
        const response = await mockFlareDaemon.trigger();
        const nowTs = await time.latest() as BN;
        // Assert
        const { 
          0: recognizedInflationWei, 
          1: daysInAnnum,
          2: startTimeStamp,
          3: endTimeStamp } = await inflation.getCurrentAnnum() as any;
        assert.equal(recognizedInflationWei, inflationForAnnum);
        assert.equal(daysInAnnum, 365);
        assert.equal(startTimeStamp, nowTs.toNumber());
        assert.equal(endTimeStamp, nowTs.addn((365 * 86400) - 1).toNumber());
        await expectEvent.inTransaction(response.tx, inflation, INFLATIONRECOGNIZED_EVENT, { amountWei: recognizedInflationWei });
      });
    });

    describe("recognize", async() => {
      it("Should recognize new annum when year rolls over", async() => {
        // Assume blockchain start time is 1/1/2021 - not a leap year
        // 2022 is also not a leap year...
        // Assemble
        await mockFlareDaemon.trigger();
        const nowTs = await time.latest() as BN;
        // A year passes...
        await time.increaseTo(nowTs.addn((365 * 86400)));
        // Act
        const response = await mockFlareDaemon.trigger();
        // Assert
        const {4: recognizedInflation} = await inflation.getTotals();
        // We should have twice the recognized inflation accumulated...
        assert.equal(recognizedInflation.toNumber(), inflationForAnnum * 2);
        await expectEvent.inTransaction(response.tx, inflation, INFLATIONRECOGNIZED_EVENT, { amountWei: inflationForAnnum.toString() });
      });
    });

    describe("annums lengths", async() => {
      function isLeapYear(year: number) {
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      }
      
      async function timestampToDate(timestamp: BN): Promise<[year: number, month: number, day: number]> {
        const { 0: year, 1: month, 2: day } = await dateTimeContract.timestampToDate(timestamp);
        return [year.toNumber(), month.toNumber(), day.toNumber()];
      }
      
      /**
       * Return first timestamp after `timestamp` that has the given month and day
       * and for which the year is of type `yearType`.
       * @returns a timestamp for calculated date
       */
      async function firstDateLike(timestamp: BN, yearType: 'leap' | 'before_leap' | 'ordinary' | null, month: number, day: number): Promise<BN> {
        let [year, cmonth, cday] = await timestampToDate(timestamp);
        // advance year if month,day is before or equal to current date
        if (cmonth > month || (cmonth === month && cday >= day)) ++year;
        // adjust for leap year
        if (yearType !== null) {
          const yearsToLeapYearDict = { leap: 0, before_leap: 1, ordinary: 2 };
          const yearsToLeapYear = yearsToLeapYearDict[yearType];
          while (!isLeapYear(year + yearsToLeapYear)) ++year;
        }
        // convert back to timestamp
        // console.log(`Test date: ${year}-${month}-${day}`);
        return await dateTimeContract.timestampFromDate(year, month, day);
      }
      
      it("Test firstDateLike calculation", async() => {
        async function equalDate(timestamp: BN, [year, month, day]: [number, number, number]) {
          const datets = await dateTimeContract.timestampFromDate(year, month, day);
          assert.equal(timestamp.toNumber(), datets.toNumber());
        }
        {
          const current = await dateTimeContract.timestampFromDate(2020, 1, 8);
          await equalDate(await firstDateLike(current, null, 2, 1), [2020, 2, 1]);
          await equalDate(await firstDateLike(current, 'leap', 2, 1), [2020, 2, 1]);
          await equalDate(await firstDateLike(current, 'before_leap', 2, 1), [2023, 2, 1]);
          await equalDate(await firstDateLike(current, 'ordinary', 2, 1), [2022, 2, 1]);
        }
        {
          const current = await dateTimeContract.timestampFromDate(2022, 5, 1);
          await equalDate(await firstDateLike(current, null, 2, 1), [2023, 2, 1]);
          await equalDate(await firstDateLike(current, 'leap', 2, 1), [2024, 2, 1]);
          await equalDate(await firstDateLike(current, 'before_leap', 2, 1), [2023, 2, 1]);
          await equalDate(await firstDateLike(current, 'ordinary', 2, 1), [2026, 2, 1]);
        }
        {
          const current = await dateTimeContract.timestampFromDate(2021, 2, 1);
          await equalDate(await firstDateLike(current, null, 2, 1), [2022, 2, 1]);
        }
      });
      
      it("Counting annum length in non leap year", async() => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;  
        // a year yyyy-02-01 in the the future, that is not leap year
        const timestampTest = await firstDateLike(nowTs, 'ordinary', 2, 1);
        // Make sure the current blockchain time is before timestampTest
        // this should always pass
        assert.isAtLeast(timestampTest.toNumber(), nowTs.toNumber(), "Too many tests before this test, increase the starting time");
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const { 
          1: daysInAnnum,
          2: startTimeStamp,
          3: endTimeStamp } = await inflation.getCurrentAnnum() as any;
        // Assert
        // Check that daysInAnnum parameter is working correctly
        assert.equal(daysInAnnum,365);
        // Check that start and end timestamp are actually 365 days appart -1 sec as designed
        assert.equal(endTimeStamp-startTimeStamp,365*24*60*60-1);
      });

      it("Counting annum length starting from date not in leap year " +
        "but after march one year before leap year", async() => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;  
        // a year yyyy-06-30 in the the future, that has 1 years to leap year
        const timestampTest = await firstDateLike(nowTs, 'before_leap', 6, 30);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const { 
          1: daysInAnnum,
          2: startTimeStamp,
          3: endTimeStamp } = await inflation.getCurrentAnnum() as any;
        // Assert
        assert.equal(daysInAnnum,366);
        assert.equal(endTimeStamp-startTimeStamp,366*24*60*60-1);
      });

      it("Counting annum length starting on 28/2 not in leap year " +
        "but one year before leap year", async() => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;  
        // a year yyyy-02-28 in the the future, that has 1 year to leap year
        const timestampTest = await firstDateLike(nowTs, 'before_leap', 2, 28);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const { 
          1: daysInAnnum,
          2: startTimeStamp,
          3: endTimeStamp } = await inflation.getCurrentAnnum() as any;
        // Assert
        assert.equal(daysInAnnum,365);
        assert.equal(endTimeStamp-startTimeStamp,365*24*60*60-1);
      });

      it("Counting annum length starting from date in leap year " +
        "but after 29/2 in a leap year", async() => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;  
        // a year yyyy-06-30 in the the future, that is a leap year
        const timestampTest = await firstDateLike(nowTs, 'leap', 6, 30);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const { 
          1: daysInAnnum,
          2: startTimeStamp,
          3: endTimeStamp } = await inflation.getCurrentAnnum() as any;
        // Assert
        assert.equal(daysInAnnum,365);
        assert.equal(endTimeStamp-startTimeStamp,365*24*60*60-1);
      });

      it("Counting annum length starting on 29/2 in a leap year", async() => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;  
        // a year yyyy-02-29 in the the future, that is a leap year
        const timestampTest = await firstDateLike(nowTs, 'leap', 2, 29);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const { 
          1: daysInAnnum,
          2: startTimeStamp,
          3: endTimeStamp } = await inflation.getCurrentAnnum() as any;
        // Assert
        assert.equal(daysInAnnum,365);
        assert.equal(endTimeStamp-startTimeStamp,365*24*60*60-1);
      });
    });

    describe("authorize", async() => {
      it("Should not authorize inflation if no sharing percentages", async() => {
        // Assemble
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const {0: authorizedInflation} = await inflation.getTotals();
        assert.equal(authorizedInflation.toNumber(), 0);
      });

      it("Should authorize inflation - first cycle, 1 sharing percentage", async() => {
        // Assemble
        // Set up one sharing percentage
        const sharingPercentages = [];
        const inflationReceiver = await MockContract.new();
        sharingPercentages[0] = {inflationReceiver: inflationReceiver.address, percentBips: 10000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        const response = await mockFlareDaemon.trigger();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        const {0: actualAuthorizedInflation} = await inflation.getTotals();
        assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
        await expectEvent.inTransaction(response.tx, inflation, INFLATIONAUTHORIZED_EVENT, { amountWei: expectedAuthorizedInflation.toString() });
        await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT, { inflationReceiver: inflationReceiver.address, amountWei: expectedAuthorizedInflation.toString() });
      });

      it("Should authorize inflation - first cycle, 2 sharing percentages", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        const {0: actualAuthorizedInflation} = await inflation.getTotals();
        // Check authorized inflation across annums (only 1 annum tho)
        assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check authorized inflation total for current annum
        assert.equal(rewardServicesState.totalAuthorizedInflationWei, expectedAuthorizedInflation);
        // Check authorized inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].authorizedInflationWei, Math.floor(expectedAuthorizedInflation * 0.3));
        // Check authorized inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].authorizedInflationWei, expectedAuthorizedInflation - Math.floor(expectedAuthorizedInflation * 0.3));
      });  

      it("Should authorize inflation - first cycle, 3 sharing percentages", async() => {
        // Assemble
        // Set up three sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3333};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3334};
        sharingPercentages[2] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3333};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        const {0: actualAuthorizedInflation} = await inflation.getTotals();
        // Check authorized inflation across annums (only 1 annum tho)
        assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check authorized inflation total for current annum
        assert.equal(rewardServicesState.totalAuthorizedInflationWei, expectedAuthorizedInflation);
        // Check authorized inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].authorizedInflationWei, Math.floor(expectedAuthorizedInflation * 0.3333));
        // Check authorized inflation for second reward service
        assert.equal(rewardServicesState.rewardServices[1].authorizedInflationWei, Math.floor(expectedAuthorizedInflation * 0.3334));
        // Check authorized inflation for the third reward service
        assert.equal(rewardServicesState.rewardServices[2].authorizedInflationWei, expectedAuthorizedInflation - Math.floor(expectedAuthorizedInflation * 0.3334) - Math.floor(expectedAuthorizedInflation * 0.3333));
      });  

      it("Should authorize inflation - second cycle, 2 sharing percentages", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        await mockFlareDaemon.trigger();
        const nowTs = await time.latest() as BN;
        // A day passes...
        await time.increaseTo(nowTs.addn(86400));
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const expectedAuthorizedInflationCycle1 = Math.floor(inflationForAnnum / 365);
        const expectedAuthorizedInflationCycle2 = Math.floor((inflationForAnnum - expectedAuthorizedInflationCycle1) / 364);
        const expectedAuthorizedInflation = expectedAuthorizedInflationCycle1 + expectedAuthorizedInflationCycle2;
        const {0: actualAuthorizedInflation} = await inflation.getTotals();
        // Check authorized inflation across annums (only 1 annum tho)
        assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
        // Compute authorized inflation total for cycle 2, each service
        const expectedAuthorizedInflationCycle2Service1 =
          Math.floor(expectedAuthorizedInflationCycle1 * 0.3) + 
          Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
        const expectedAuthorizedInflationCycle2Service2 = 
          expectedAuthorizedInflation - 
          expectedAuthorizedInflationCycle2Service1;
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check authorized inflation total for current annum
        assert.equal(rewardServicesState.totalAuthorizedInflationWei, expectedAuthorizedInflation);
        // Check authorized inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].authorizedInflationWei, expectedAuthorizedInflationCycle2Service1);
        // Check authorized inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].authorizedInflationWei, expectedAuthorizedInflationCycle2Service2);
      });
      
      it("Should authorize inflation on rewarding service contract", async() => {
        // Assemble
        // Set up one sharing percentage
        const sharingPercentages = [];
        const rewardingServiceContract = await MockContract.new();
        sharingPercentages[0] = {inflationReceiver: rewardingServiceContract.address, percentBips: 10000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        const setDailyAuthorizedInflation = mockInflationReceiverInterface.contract.methods.setDailyAuthorizedInflation(expectedAuthorizedInflation).encodeABI();
        const invocationCount = await rewardingServiceContract.invocationCountForCalldata.call(setDailyAuthorizedInflation);
        assert.equal(invocationCount.toNumber(), 1);
      });      
    });

    describe("topup", async() => {
      it("Should not topup inflation if no sharing percentages", async() => {
        // Assemble
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const {1: topup} = await inflation.getTotals();
        assert.equal(topup.toNumber(), 0);
      });

      it("Should require topup factor greater than 1 (x100) if using daily authorized", async() => {
        // Assemble
        // Act
        const setPromise = inflation.setTopupConfiguration((await MockContract.new()).address, TopupType.FACTOROFDAILYAUTHORIZED , 100);        
        // Require
        await expectRevert(setPromise, ERR_TOPUP_LOW);
      });

      it("Should disregard topup factor if using allauthorized", async() => {
        // Assemble
        // Act
        await inflation.setTopupConfiguration((await MockContract.new()).address, TopupType.ALLAUTHORIZED, 100);        
        // Require

      });

      it("Should request inflation to topup - first cycle, 2 sharing percentages, by factor type (default)", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        const inflationReceiver0 = await MockContract.new();
        const inflationReceiver1 = await MockContract.new();
        sharingPercentages[0] = {inflationReceiver: inflationReceiver0.address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: inflationReceiver1.address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        const response = await mockFlareDaemon.trigger();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        // This should cap at one days authorization...not the factor
        const expectedTopupService0 = Math.floor(expectedAuthorizedInflation * 0.3);
        const expectedTopupService1 = expectedAuthorizedInflation - expectedTopupService0;
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check topup inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].inflationTopupRequestedWei, expectedTopupService0);
        await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPCOMPUTED_EVENT, {inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0.toString()});
        // Check topup inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].inflationTopupRequestedWei, expectedTopupService1);
        await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPCOMPUTED_EVENT, {inflationReceiver: inflationReceiver1.address, amountWei: expectedTopupService1.toString()});
        await expectEvent.inTransaction(response.tx, inflation, TOPUPREQUESTED_EVENT, { amountWei: (expectedTopupService0 + expectedTopupService1).toString() });
      });

      it("Should request inflation to topup - second cycle, 2 sharing percentages, by factor type (default)", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        await mockFlareDaemon.trigger();
        const nowTs = await time.latest() as BN;
        // A day passes...
        await time.increaseTo(nowTs.addn(86400));
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const expectedAuthorizedInflationCycle1 = Math.floor(inflationForAnnum / 365);
        const expectedAuthorizedInflationCycle2 = Math.floor((inflationForAnnum - expectedAuthorizedInflationCycle1) / 364);
        const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
        const expectedAuthorizedInflationCycle2Service2 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
        const expectedTopupService1 = Math.floor(expectedAuthorizedInflationCycle2Service1 * 1.2);
        const expectedTopupService2 = Math.floor(expectedAuthorizedInflationCycle2Service2 * 1.2);
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check topup inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].inflationTopupRequestedWei, expectedTopupService1);
        // Check topup inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].inflationTopupRequestedWei, expectedTopupService2);
      });

      it("Should request inflation to topup - second cycle, 2 sharing percentages, for type all authorized", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        const serviceReceiver1 = await MockContract.new();
        const serviceReceiver2 = await MockContract.new();
        sharingPercentages[0] = {inflationReceiver: serviceReceiver1.address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: serviceReceiver2.address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        await inflation.setTopupConfiguration(serviceReceiver1.address, TopupType.ALLAUTHORIZED, 0);        
        await inflation.setTopupConfiguration(serviceReceiver2.address, TopupType.ALLAUTHORIZED, 0);        
        await mockFlareDaemon.trigger();
        const nowTs = await time.latest() as BN;
        // A day passes...
        await time.increaseTo(nowTs.addn(86400));
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check topup inflation for first reward service
        assert.equal(
          rewardServicesState.rewardServices[0].inflationTopupRequestedWei,
          rewardServicesState.rewardServices[0].authorizedInflationWei
        );
        // Check topup inflation for the second reward service
        assert.equal(
          rewardServicesState.rewardServices[1].inflationTopupRequestedWei,
          rewardServicesState.rewardServices[1].authorizedInflationWei
        );
      });
    });

    describe("minting", async() => {
      it("Should request minting after a topup request is calculated", async() => {
        // Assemble
        // Set up one sharing percentage
        const sharingPercentages = [];
        const rewardingServiceContract = await MockContract.new();
        sharingPercentages[0] = {inflationReceiver: rewardingServiceContract.address, percentBips: 10000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const expectedRequestedInflation = Math.floor(inflationForAnnum / 365);
        const requestMinting = mockFlareDaemonInterface.contract.methods.requestMinting(expectedRequestedInflation).encodeABI();
        const invocationCount = await mockFlareDaemon.invocationCountForCalldata.call(requestMinting);
        assert.equal(invocationCount.toNumber(), 1);
      });

      it("Should receive toped up inflation - first cycle, 2 sharing percentages, by factor type (default)", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        const inflationReceiver0 = await MockContract.new();
        const inflationReceiver1 = await MockContract.new();
        sharingPercentages[0] = {inflationReceiver: inflationReceiver0.address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: inflationReceiver1.address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Prime topup request buckets
        await mockFlareDaemon.trigger();
        const {1: toMint} = await inflation.getTotals();
        // Act
        const response = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint});
        // Assert
        const expectedReceivedInflation = Math.floor(inflationForAnnum / 365);
        // This should cap at one days authorization...not the factor
        const expectedTopupService0 = Math.floor(expectedReceivedInflation * 0.3);
        const expectedTopupService1 = expectedReceivedInflation - expectedTopupService0;
        const {4: rewardServicesState} = await inflation.getCurrentAnnum() as any;
        // Check topup inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].inflationTopupReceivedWei, expectedTopupService0);
        await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address,  amountWei: expectedTopupService0.toString() });
        // Check topup inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].inflationTopupReceivedWei, expectedTopupService1);
        await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver1.address,  amountWei: expectedTopupService1.toString() });
        
        // Running sum should be correct
        const {2: receivedTopup} = await inflation.getTotals();
        assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
        await expectEvent.inTransaction(response.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0 + expectedTopupService1).toString() });
      });
    });

    describe("funding", async() => {

      it("Should not reward before start time", async() => {
        // Assemble
        // We must create non default inflation, since default has rewardEpoch at 0
        mockSupply = await MockContract.new();
        mockInflationPercentageProvider = await MockContract.new();
        mockInflationSharingPercentageProvider = await MockContract.new();
        mockFlareDaemon = await FlareDaemonMock.new();

        const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0,10); // first 4 bytes is function selector
        const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0,10);
        await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
        await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, inflationBips);
        
        await time.advanceBlock();
        const latest = await time.latest();

        inflation = await Inflation.new(
            accounts[0],
            mockFlareDaemon.address,
            mockInflationPercentageProvider.address,
            mockInflationSharingPercentageProvider.address,
            latest.toNumber() + 2 * 86400 // Set time sometime after now, but at least two days to trigger new inflation if not exiting preemptively
        );

        const tx = await inflation.setSupply(mockSupply.address);
        await mockFlareDaemon.registerToDaemonize(inflation.address);
       
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        // It should return directly and not change lastAuthorizationTs
        const lastTs = await inflation.lastAuthorizationTs();
        assert.equal(lastTs.toNumber(), 0);
        expectEvent(tx, SUPPLYSET_EVENT, {oldSupply: constants.ZERO_ADDRESS, newSupply: mockSupply.address});
      });

      it("Should fund toped up inflation - first cycle, 2 sharing percentages, by factor type (default)", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        const rewardingServiceContract0 = await InflationReceiverMock.new();
        const rewardingServiceContract1 = await InflationReceiverMock.new();
        sharingPercentages[0] = {inflationReceiver: rewardingServiceContract0.address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: rewardingServiceContract1.address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Prime topup request buckets
        await mockFlareDaemon.trigger();
        const {1: toMint} = await inflation.getTotals();
        // Act
        await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint});
        // Assert
        const expectedInflationFunded = Math.floor(inflationForAnnum / 365);
        // This should cap at one days authorization...not the factor
        const expectedTopupService0 = Math.floor(expectedInflationFunded * 0.3);
        const expectedTopupService1 = expectedInflationFunded - expectedTopupService0;
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check topup inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].inflationTopupWithdrawnWei, expectedTopupService0);
        // Check topup inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].inflationTopupWithdrawnWei, expectedTopupService1);
        // Running sum should be correct
        const {3: inflationWithdrawn} = await inflation.getTotals();
        assert.equal(inflationWithdrawn.toNumber() , expectedTopupService0 + expectedTopupService1);
        // Check that target reward service contracts got the native token they are due
        assert.equal((await web3.eth.getBalance(rewardingServiceContract0.address)), expectedTopupService0.toString());
        assert.equal((await web3.eth.getBalance(rewardingServiceContract1.address)), expectedTopupService1.toString());
      });

      it("Should balance while receiving self-destruct proceeds", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        const rewardingServiceContract0 = await InflationReceiverMock.new();
        sharingPercentages[0] = {inflationReceiver: rewardingServiceContract0.address, percentBips: 10000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Prime topup request buckets
        await mockFlareDaemon.trigger();
        const {1: toMint} = await inflation.getTotals();
        // Act
        // Sneak in 1 more to simulate self-destructing
        await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint.addn(1)});
        // ...and if it got here, then we balance.
        // Assert
        // Check self destruct bucket for good measure...
        const {5: selfDestructProceeds} = await inflation.getTotals();
        assert.equal(selfDestructProceeds.toNumber(), 1);
      });

      it("Should balance when receiving self-destruct amount between daemonize calls", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        const rewardingServiceContract0 = await InflationReceiverMock.new();
        sharingPercentages[0] = {inflationReceiver: rewardingServiceContract0.address, percentBips: 10000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Prime topup request buckets
        await mockFlareDaemon.trigger();
        const {1: toMint} = await inflation.getTotals();
        // Act
        // Self destruct with some native
        const suicidalMock = await SuicidalMock.new(inflation.address);
        // Give suicidal some native token
        await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: toBN(5)});
        // Attacker dies
        await suicidalMock.die();

        await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
        // ...and if it got here, then we balance.
        // Assert
        // Check self destruct bucket for good measure...
        const {5: selfDestructProceeds} = await inflation.getTotals();
        // Should record elf destruct value
        assert.equal(selfDestructProceeds.toNumber(), 5);
      });

      it("Should balance when receiving self-destruct outside between daemonize calls", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        const rewardingServiceContract0 = await InflationReceiverMock.new();
        sharingPercentages[0] = {inflationReceiver: rewardingServiceContract0.address, percentBips: 10000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Prime topup request buckets
        await mockFlareDaemon.trigger();
        const {1: toMint} = await inflation.getTotals();
        // Act
        // Self destruct with some native
        const suicidalMock = await SuicidalMock.new(inflation.address);
        // Give suicidal some native token
        await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: toBN(5)});
        // Attacker dies
        await suicidalMock.die();

        await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint.addn(1)});
        // ...and if it got here, then we balance.
        // Assert
        // Check self destruct bucket for good measure...
        const {5: selfDestructProceeds} = await inflation.getTotals();
        // Should record both self destruct and additional value
        assert.equal(selfDestructProceeds.toNumber(), 5 + 1);
      });
      
      it("Should record timestamp of the block where daemonize started in rewardEpochStartedTs when rewards started after 0", async() => {
        // Assemble
        mockSupply = await MockContract.new();
        mockInflationPercentageProvider = await MockContract.new();
        mockInflationSharingPercentageProvider = await MockContract.new();
        mockFlareDaemon = await FlareDaemonMock.new();

        const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0,10); // first 4 bytes is function selector
        const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0,10);
        await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
        await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, inflationBips);
        
        await time.advanceBlock();
        const latest = await time.latest();
        inflation = await Inflation.new(
            accounts[0],
            mockFlareDaemon.address,
            mockInflationPercentageProvider.address,
            mockInflationSharingPercentageProvider.address,
            latest // Set time to now
        );
        
        await inflation.setSupply(mockSupply.address);
        await mockFlareDaemon.registerToDaemonize(inflation.address);
        const rewardTime = (await time.latest()).addn(86400); // Initiate daemonize some time after the reward start time
        await time.increaseTo(rewardTime);
        // Act
        await mockFlareDaemon.trigger();
        // Assert
        const lastTs = (await inflation.rewardEpochStartedTs()).toNumber();
        
        assert.isTrue(lastTs - 1 == rewardTime.toNumber() || lastTs == rewardTime.toNumber()); // Hardhat automatically advances time for 1 second after each transaction.
      });

    });

    describe("helper methods", async() => {
      it("Should get an annum by index", async() => {
        // Assemble
        await mockFlareDaemon.trigger();
        // Act
        const { recognizedInflationWei } = await inflation.getAnnum(0);
        // Assert
        assert.equal(recognizedInflationWei, BN(inflationForAnnum));
      });

      it("Should set InflationPercentageProvider", async()=> {
        // Assemble
        const newMockInflationPercentageProvider = await MockContract.new();
        
        // Act
        await inflation.setInflationPercentageProvider(newMockInflationPercentageProvider.address);
        
        // Assert
        assert.equal((await inflation.inflationPercentageProvider()), newMockInflationPercentageProvider.address);

      });

      it("Should reject InflationPercentageProvider change if not from governed", async() => {
        // Assemble
        const newMockInflationPercentageProvider = await MockContract.new();
        
        // Act
        const changePromise = inflation.setInflationPercentageProvider(newMockInflationPercentageProvider.address, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ONLY_GOVERNANCE_MSG);
        assert.equal((await inflation.inflationPercentageProvider()), mockInflationPercentageProvider.address);
      });

      it("Should reject InflationPercentageProvider change with 0 address", async() => {
        // Assemble
        
        // Act
        const changePromise = inflation.setInflationPercentageProvider(constants.ZERO_ADDRESS);
        
        // Assert
        await expectRevert(changePromise, ERR_IS_ZERO);
        assert.equal((await inflation.inflationPercentageProvider()), mockInflationPercentageProvider.address);
      });

      it("Should set InflationSharingPercentageProvider", async()=> {
        // Assemble
        const newMockInflationSharingPercentageProvider = await MockContract.new();
        
        // Act
        await inflation.setInflationSharingPercentageProvider(newMockInflationSharingPercentageProvider.address);
        
        // Assert
        assert.equal((await inflation.inflationSharingPercentageProvider()), newMockInflationSharingPercentageProvider.address);

      });

      it("Should reject InflationSharingPercentageProvider change if not from governed", async() => {
        // Assemble
        const newMockInflationSharingPercentageProvider = await MockContract.new();
        
        // Act
        const changePromise = inflation.setInflationSharingPercentageProvider(newMockInflationSharingPercentageProvider.address, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ONLY_GOVERNANCE_MSG);
        assert.equal((await inflation.inflationSharingPercentageProvider()), mockInflationSharingPercentageProvider.address);
      });

      it("Should reject InflationSharingPercentageProvider change with 0 address", async() => {
        // Assemble
        
        // Act
        const changePromise = inflation.setInflationSharingPercentageProvider(constants.ZERO_ADDRESS);
        
        // Assert
        await expectRevert(changePromise, ERR_IS_ZERO);
        assert.equal((await inflation.inflationSharingPercentageProvider()), mockInflationSharingPercentageProvider.address);
      });

      it("Should set new flare daemon", async()=> {
        // Assemble
        const newMockFlareDaemon = await MockContract.new();
        
        // Act
        await inflation.setFlareDaemon(newMockFlareDaemon.address);
        
        // Assert
        assert.equal((await inflation.flareDaemon()), newMockFlareDaemon.address);

      });

      it("Should reject flare daemon change if not from governed", async() => {
        // Assemble
        const newMockFlareDaemon = await MockContract.new();
        
        // Act
        const changePromise = inflation.setFlareDaemon(newMockFlareDaemon.address, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ONLY_GOVERNANCE_MSG);
        assert.equal((await inflation.flareDaemon()), mockFlareDaemon.address);
      });

      it("Should reject flare daemon with 0 address", async() => {
        // Assemble
        
        // Act
        const changePromise = inflation.setFlareDaemon(constants.ZERO_ADDRESS);
        
        // Assert
        await expectRevert(changePromise, "flare daemon zero");
        assert.equal((await inflation.flareDaemon()), mockFlareDaemon.address);
      });

      it("Should set new supply", async()=> {
        // Assemble
        
        const newMocksupply = await MockContract.new();
        
        // Act
        await inflation.setSupply(newMocksupply.address);
        
        // Assert
        assert.equal((await inflation.supply()), newMocksupply.address);

      });

      it("Should reject supply change if not from governed", async() => {
        // Assemble
        const newMockSupply = await MockContract.new();
        
        // Act
        const changePromise = inflation.setSupply(newMockSupply.address, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ONLY_GOVERNANCE_MSG);
        assert.equal((await inflation.supply()), mockSupply.address);
      });

      it("Should reject supply with 0 address", async() => {
        // Assemble
        
        // Act
        const changePromise = inflation.setSupply(constants.ZERO_ADDRESS);
        
        // Assert
        await expectRevert(changePromise, ERR_IS_ZERO);
        assert.equal((await inflation.supply()), mockSupply.address);
      });

      it("Should not allow topup configuration change if not from governance", async() => {
        // Assemble
        // Act
        const setPromise = inflation.setTopupConfiguration((await MockContract.new()).address, TopupType.ALLAUTHORIZED, 100, {from: accounts[2]});        
        // Require
        await expectRevert(setPromise, ONLY_GOVERNANCE_MSG);
      });

      it("Should not allow topup configuration change with 0 address", async() => {
        // Assemble
        // Act
        const setPromise = inflation.setTopupConfiguration(constants.ZERO_ADDRESS, TopupType.ALLAUTHORIZED, 100);        
        // Require
        await expectRevert(setPromise, ERR_IS_ZERO);
      });

      it("Should set and retrieve topup configuration", async () => {
        // This will be changed in the future to only return values for valid inflation requests
        // Assemble
        const mockInflation1 = await MockContract.new();
        const t1Type = TopupType.ALLAUTHORIZED;
        const t1Factor = 0;
        const mockInflation2 = await MockContract.new();
        const t2Type = TopupType.ALLAUTHORIZED;
        const t2Factor = 10;
        const t2TypeFinal = TopupType.ALLAUTHORIZED;
        const t2FactorFinal = 300;
        const mockInflation3 = await MockContract.new();
        
        // Act
        await inflation.setTopupConfiguration(mockInflation1.address, t1Type, t1Factor);
        // Assert
        const t1Result = await inflation.getTopupConfiguration.call(mockInflation1.address);
        assert.equal(t1Result.configured, true);
        assert.equal(t1Result.topupType, BN(t1Type));
        assert.equal(t1Result.topupFactorX100, BN(t1Factor));
        // t2 and 3 should be default
        const t2ResultDefault = await inflation.getTopupConfiguration.call(mockInflation2.address);
        assert.equal(t2ResultDefault.configured, true);
        assert.equal(t2ResultDefault.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
        assert.equal(t2ResultDefault.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

        const t3Result = await inflation.getTopupConfiguration.call(mockInflation3.address);
        assert.equal(t3Result.configured, true);
        assert.equal(t3Result.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
        assert.equal(t3Result.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));
        
        // Adding another should not change previous
        // Act
        await inflation.setTopupConfiguration(mockInflation2.address, t2Type, t2Factor);
        const t1Result2 = await inflation.getTopupConfiguration.call(mockInflation1.address);
        assert.equal(t1Result2.configured, true);
        assert.equal(t1Result2.topupType, BN(t1Type));
        assert.equal(t1Result2.topupFactorX100, BN(t1Factor));
        const t2Result = await inflation.getTopupConfiguration.call(mockInflation2.address);
        assert.equal(t2Result.configured, true);
        assert.equal(t2Result.topupType, BN(t2Type));
        assert.equal(t2Result.topupFactorX100, BN(t2Factor));
        const t3Result2 = await inflation.getTopupConfiguration.call(mockInflation3.address);
        assert.equal(t3Result2.configured, true);
        assert.equal(t3Result2.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
        assert.equal(t3Result2.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

        // Can update multiple times
        await inflation.setTopupConfiguration(mockInflation2.address, t2TypeFinal, t2FactorFinal);
        const t1Result3 = await inflation.getTopupConfiguration.call(mockInflation1.address);
        assert.equal(t1Result3.configured, true);
        assert.equal(t1Result3.topupType, BN(t1Type));
        assert.equal(t1Result3.topupFactorX100, BN(t1Factor));
        const t2ResultFinal = await inflation.getTopupConfiguration.call(mockInflation2.address);
        assert.equal(t2ResultFinal.configured, true);
        assert.equal(t2ResultFinal.topupType, BN(t2TypeFinal));
        assert.equal(t2ResultFinal.topupFactorX100, BN(t2FactorFinal));
        const t3Result3 = await inflation.getTopupConfiguration.call(mockInflation3.address);
        assert.equal(t3Result3.configured, true);
        assert.equal(t3Result3.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
        assert.equal(t3Result3.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      });

    });

});
