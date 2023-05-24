import {
  FlareDaemonInstance,
  FlareDaemonMockInstance,
  FlareDaemonMock1Instance,
  FlareDaemonMock2Instance,
  InflationInstance,
  InflationReceiverMockInstance,
  MockContractInstance, BokkyPooBahsDateTimeContractInstance,
  InflationAllocationInstance
} from "../../../../typechain-truffle";

import { constants, expectRevert, expectEvent, time } from '@openzeppelin/test-helpers';
import { encodeContractNames, toBN } from "../../../utils/test-helpers";
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { governanceAccounts } from "../../../../deployment/scripts/multisig-governance-accounts";
const getTestFile = require('../../../utils/constants').getTestFile;

const Inflation = artifacts.require("Inflation");
const MockContract = artifacts.require("MockContract");
const PercentageProviderMock = artifacts.require("PercentageProviderMock");
const InflationReceiverMock = artifacts.require("InflationReceiverMock");
const FlareDaemonMock = artifacts.require("FlareDaemonMock");
const FlareDaemonMock1 = artifacts.require("FlareDaemonMock1");
const FlareDaemonMock2 = artifacts.require("FlareDaemonMock2");
const FlareDaemon = artifacts.require("FlareDaemon");
const SuicidalMock = artifacts.require("SuicidalMock");
const InflationAllocation = artifacts.require("InflationAllocation");

// This library has a lot of unit tests, so it seems, that we should be able to use it for
// timestamp conversion
const DateTimeContract = artifacts.require("BokkyPooBahsDateTimeContract");

const ERR_TOPUP_LOW = "topup low";
const ONLY_GOVERNANCE_MSG = "only governance";
const ERR_IS_ZERO = "address is 0";
const ERR_NO_TIME_SLOT = "no time slot";

const INFLATIONAUTHORIZED_EVENT = "InflationAuthorized";
const TIME_SLOT_INITIALIZED_EVENT = "NewTimeSlotInitialized";
const TOPUPREQUESTED_EVENT = "TopupRequested";
const REWARDSERVICETOPUPCOMPUTED_EVENT = "InflationRewardServiceTopupComputed";
const REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT = "InflationRewardServiceDailyAuthorizedInflationComputed";
const SUPPLYSET_EVENT = "SupplySet";
const MINTINGRECEIVED_EVENT = "MintingReceived";
const REWARDSERVICETOPUPREQUESTRECEIVED_EVENT = "InflationRewardServiceTopupRequestReceived";
const DAY = 60 * 60 * 24;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

enum TopupType { FACTOROFDAILYAUTHORIZED, ALLAUTHORIZED }

const DEFAULT_TOPUP_FACTOR_X100 = 120;

const BN = web3.utils.toBN;
const getExpectedBalance = web3.utils.sha3("getExpectedBalance()")!.slice(0, 10); // first 4 bytes is function selector

contract(`Inflation.sol; ${getTestFile(__filename)}; Inflation unit tests`, async accounts => {
  const ADDRESS_UPDATER = accounts[16];
  // contains a fresh contract for each test
  let mockSupply: MockContractInstance;
  let mockInflationPercentageProvider: MockContractInstance;
  let inflation: InflationInstance;
  let inflation1: InflationInstance;
  let inflation2: InflationInstance;
  let mockInflationReceiverInterface: InflationReceiverMockInstance;
  let mockFlareDaemon: FlareDaemonMockInstance;
  let mockFlareDaemon1: FlareDaemonMock1Instance;
  let mockFlareDaemon2: FlareDaemonMock2Instance;
  let mockFlareDaemonInterface: FlareDaemonInstance;
  let startTs: BN;
  let dateTimeContract: BokkyPooBahsDateTimeContractInstance;
  const supply = 1000000;
  const inflationBips = 1000;
  const inflationFactor = inflationBips / 10000;
  const inflationForTimeSlot = Math.floor(supply * inflationFactor / 12);
  const maxMint = Math.floor(inflationForTimeSlot / 30 * 7);
  let inflationAllocation: InflationAllocationInstance;

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

  before(async () => {
    dateTimeContract = await DateTimeContract.new();
    // Assemble
    await time.advanceBlock();
    const nowTs = await time.latest() as BN;
    // a year yyyy-01-01 in the the future, that is not leap year
    const timestampTest = await firstDateLike(nowTs, 'ordinary', 1, 1);
    // Make sure the current blockchain time is before timestampTest
    // this should always pass
    assert.isAtLeast(timestampTest.toNumber(), nowTs.toNumber(), "Too many tests before this test, increase the starting time");
    // Act
    await time.increaseTo(timestampTest);
  });

  beforeEach(async () => {
    mockSupply = await MockContract.new();
    mockInflationPercentageProvider = await MockContract.new();
    mockInflationReceiverInterface = await InflationReceiverMock.new();
    mockFlareDaemon = await FlareDaemonMock.new();
    mockFlareDaemon1 = await FlareDaemonMock1.new();
    mockFlareDaemon2 = await FlareDaemonMock2.new();
    mockFlareDaemonInterface = await FlareDaemon.new();
    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();

    const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0, 10); // first 4 bytes is function selector
    const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
    await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
    await mockInflationPercentageProvider.givenMethodReturnUint(getTimeSlotPercentageBips, inflationBips);

    inflation = await Inflation.new(
      accounts[0],
      mockFlareDaemon.address,
      ADDRESS_UPDATER,
      0
    );

    inflation1 = await Inflation.new(
      accounts[0],
      mockFlareDaemon1.address,
      ADDRESS_UPDATER,
      0
    );

    inflation2 = await Inflation.new(
      accounts[0],
      mockFlareDaemon2.address,
      ADDRESS_UPDATER,
      0
    );

    inflationAllocation = await InflationAllocation.new(
      accounts[0],
      ADDRESS_UPDATER,
      [3, 2, 1]
    );
    await inflationAllocation.updateContractAddresses(
			encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
			[ADDRESS_UPDATER, inflation.address], {from: ADDRESS_UPDATER});

    await inflation.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
      [ADDRESS_UPDATER, mockSupply.address, mockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});
    await inflation1.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
      [ADDRESS_UPDATER, mockSupply.address, mockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});
    await inflation2.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
      [ADDRESS_UPDATER, mockSupply.address, mockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});
    await mockFlareDaemon.registerToDaemonize(inflation.address);

    await mockFlareDaemon.givenMethodReturnUint(mockFlareDaemonInterface.contract.methods.maxMintingRequestWei().encodeABI(), maxMint);
  });

  describe("init", async () => {
    it("Should sum recognized inflation", async () => {
      // Assemble
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const { 3: recognizedInflation } = await inflation.getTotals();
      assert.equal(recognizedInflation.toNumber(), inflationForTimeSlot);
    });

    it("Should initialize the time slot", async () => {
      // Assemble
      // Assume blockchain start time is 1/1 (not a leap year)
      // Act
      const response = await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      const newTimeSlot = await inflation.getCurrentTimeSlot();

      // Assert
      const {
        0: recognizedInflationWei,
        1: startTimeStamp,
        2: endTimeStamp } = await inflation.getCurrentTimeSlot() as any;
      assert.equal(recognizedInflationWei, inflationForTimeSlot);
      assert.equal(startTimeStamp, nowTs.toNumber());
      assert.equal(endTimeStamp, nowTs.addn((30 * 86400) - 1).toNumber());

      //const inflatableBalanceWei = await mockSupply.getInflatableBalance();
      await expectEvent.inTransaction(response.tx, inflation, TIME_SLOT_INITIALIZED_EVENT, {
        startTimeStamp: newTimeSlot.startTimeStamp,
        endTimeStamp: newTimeSlot.endTimeStamp,
        inflatableSupplyWei: toBN(supply),
        recognizedInflationWei: newTimeSlot.recognizedInflationWei
      });
    });

    it("Should copy data from old inflation and create a new time slot after a day", async () => {
      // Assemble
      const oldInflation = await MockContract.new();
      const now = await time.latest();
      const lastAuthorizationTs = now.subn(10);
      const rewardEpochStartedTs = now.subn(1000);
      await oldInflation.givenMethodReturnUint(inflation.contract.methods.lastAuthorizationTs().encodeABI(), lastAuthorizationTs);
      await oldInflation.givenMethodReturnUint(inflation.contract.methods.rewardEpochStartedTs().encodeABI(), rewardEpochStartedTs);

      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      const receiver3 = await MockContract.new();
      const annum0 = web3.eth.abi.encodeParameters(
        [ "uint256", "uint256", "uint256", "tuple(tuple(address, uint256, uint256, uint256, uint256, uint256)[], uint256, uint256, uint256, uint256)"],
        [ 0, 0, 0, [[[receiver1.address, 5, 2, 4, 4, 4], [receiver2.address, 6, 1, 5, 5, 5]], 0, 0, 0, 0] ]);
      await oldInflation.givenCalldataReturn(web3.eth.abi.encodeFunctionCall({type: "function", name: "getAnnum", inputs: [{name: "_index", type: "uint256"}]} as AbiItem, ["0"]), annum0);
      const annum1 = web3.eth.abi.encodeParameters(
        [ "uint256", "uint256", "uint256", "tuple(tuple(address, uint256, uint256, uint256, uint256, uint256)[], uint256, uint256, uint256, uint256)"],
        [ 0, 0, 0, [[[receiver2.address, 9, 2, 6, 6, 6], [receiver3.address, 7, 3, 3, 2, 2]], 0, 0, 0, 0] ]);
      await oldInflation.givenCalldataReturn(web3.eth.abi.encodeFunctionCall({type: "function", name: "getAnnum", inputs: [{name: "_index", type: "uint256"}]} as AbiItem, ["1"]), annum1);

      // Act
      await inflation.setInitialData(oldInflation.address, 2);
      // Assert
      const { 0: totalAuthorizedInflation, 1: totalInflationTopupRequested, 2: totalInflationTopupDistributed, 3: totalRecognizedInflationWei } = await inflation.getTotals();
      assert.equal(totalAuthorizedInflation.toNumber(), 27);
      assert.equal(totalInflationTopupRequested.toNumber(), 18);
      assert.equal(totalInflationTopupDistributed.toNumber(), 17);
      assert.equal(totalRecognizedInflationWei.toNumber(), 27);

      const rewardServicesState = await inflation.getRewardServices() as any;
      assert.equal(rewardServicesState.length, 3);

      // only in first annum
      assert.equal(rewardServicesState[0].inflationReceiver, receiver1.address);
      assert.equal(rewardServicesState[0].authorizedInflationWei, 5);
      assert.equal(rewardServicesState[0].lastDailyAuthorizedInflationWei, 2);
      assert.equal(rewardServicesState[0].inflationTopupRequestedWei, 4);
      assert.equal(rewardServicesState[0].inflationTopupDistributedWei, 4);

      // in both annums
      assert.equal(rewardServicesState[1].inflationReceiver, receiver2.address);
      assert.equal(rewardServicesState[1].authorizedInflationWei, 15);
      assert.equal(rewardServicesState[1].lastDailyAuthorizedInflationWei, 2);
      assert.equal(rewardServicesState[1].inflationTopupRequestedWei, 11);
      assert.equal(rewardServicesState[1].inflationTopupDistributedWei, 11);

      // only in second annum
      assert.equal(rewardServicesState[2].inflationReceiver, receiver3.address);
      assert.equal(rewardServicesState[2].authorizedInflationWei, 7);
      assert.equal(rewardServicesState[2].lastDailyAuthorizedInflationWei, 3);
      assert.equal(rewardServicesState[2].inflationTopupRequestedWei, 3);
      assert.equal(rewardServicesState[2].inflationTopupDistributedWei, 2);

      await expectRevert(inflation.setInitialData(oldInflation.address, 2, { from: accounts[2] }), ONLY_GOVERNANCE_MSG);
      await expectRevert(inflation.setInitialData(oldInflation.address, 2), "already initialized");

      const currentTimeSlotId = await inflation.getCurrentTimeSlotId();
      assert.equal(currentTimeSlotId.toNumber(), 0);
      const timeSlot = await inflation.getTimeSlot(currentTimeSlotId);
      const currentTimeSlot = await inflation.getCurrentTimeSlot();

      assert.equal(timeSlot.recognizedInflationWei.toString(), "27");
      assert.equal(currentTimeSlot.recognizedInflationWei.toString(), "27");
      assert.equal(currentTimeSlot.startTimeStamp.toString(), rewardEpochStartedTs.toString());
      assert.equal(currentTimeSlot.endTimeStamp.toString(), lastAuthorizationTs.addn(24 * 3600 - 1).toString());

      await time.increaseTo(lastAuthorizationTs.addn(24 * 3600 - 2));
      await mockFlareDaemon.trigger();
      assert.equal((await inflation.getCurrentTimeSlotId()).toNumber(), 0);
      await mockFlareDaemon.trigger();
      assert.equal((await inflation.getCurrentTimeSlotId()).toNumber(), 1);
    });
  });

  describe("recognize", async () => {
    it("Should recognize new time slot when time slot rolls over", async () => {
      // Assume blockchain start time is 1/1 (not a leap year)
      // next year is also not a leap year...
      // Assemble
      await expectRevert(inflation.getTimeSlot(0), ERR_NO_TIME_SLOT);
      await expectRevert(inflation.getCurrentTimeSlot(), ERR_NO_TIME_SLOT);
      await expectRevert(inflation.getCurrentTimeSlotId(), ERR_NO_TIME_SLOT);
      await mockFlareDaemon.trigger();
      const firstTimeSlot = await inflation.getCurrentTimeSlot();
      const nowTs = await time.latest() as BN;
      // A month passes...
      await time.increaseTo(nowTs.addn((30 * 86400)));
      // Act
      const response = await mockFlareDaemon.trigger();
      const newTimeSlot = await inflation.getCurrentTimeSlot();
      const newTimeSlotId = await inflation.getCurrentTimeSlotId();
      const timeSlot = await inflation.getTimeSlot(newTimeSlotId);
      // Assert
      assert.equal(newTimeSlotId.toNumber(), 1);
      assert.isTrue(toBN(firstTimeSlot.endTimeStamp).lt(toBN(newTimeSlot.startTimeStamp)));
      assert.equal(newTimeSlot.startTimeStamp.toString(), timeSlot.startTimeStamp.toString());
      const { 3: recognizedInflation } = await inflation.getTotals();
      // We should have twice the recognized inflation accumulated...
      assert.equal(recognizedInflation.toNumber(), inflationForTimeSlot * 2);

      await expectEvent.inTransaction(response.tx, inflation, TIME_SLOT_INITIALIZED_EVENT, {
        startTimeStamp: newTimeSlot.startTimeStamp,
        endTimeStamp: newTimeSlot.endTimeStamp,
        inflatableSupplyWei: toBN(supply),
        recognizedInflationWei: newTimeSlot.recognizedInflationWei
      });
    });
  });

  describe("time slot lengths", async () => {
    it("Test firstDateLike calculation", async () => {
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

    it("Counting time slot length", async () => {
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
        1: startTimeStamp,
        2: endTimeStamp } = await inflation.getCurrentTimeSlot() as any;
      // Assert
      // Check that start and end timestamp are actually 30 days appart -1 sec as designed
      assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
    });

    it("Counting time slot length starting from date not in leap year " +
      "but after march one year before leap year", async () => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;
        // a year yyyy-06-30 in the the future, that has 1 years to leap year
        const timestampTest = await firstDateLike(nowTs, 'before_leap', 6, 30);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const {
          1: startTimeStamp,
          2: endTimeStamp } = await inflation.getCurrentTimeSlot() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting time slot length starting on 28/2 not in leap year " +
      "but one year before leap year", async () => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;
        // a year yyyy-02-28 in the the future, that has 1 year to leap year
        const timestampTest = await firstDateLike(nowTs, 'before_leap', 2, 28);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const {
          1: startTimeStamp,
          2: endTimeStamp } = await inflation.getCurrentTimeSlot() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting time slot length starting from date in leap year " +
      "but after 29/2 in a leap year", async () => {
        // Assemble
        await time.advanceBlock();
        const nowTs = await time.latest() as BN;
        // a year yyyy-06-30 in the the future, that is a leap year
        const timestampTest = await firstDateLike(nowTs, 'leap', 6, 30);
        // Act
        await time.increaseTo(timestampTest);
        await mockFlareDaemon.trigger();
        const {
          1: startTimeStamp,
          2: endTimeStamp } = await inflation.getCurrentTimeSlot() as any;
        // Assert
        assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
      });

    it("Counting time slot length starting on 29/2 in a leap year", async () => {
      // Assemble
      await time.advanceBlock();
      const nowTs = await time.latest() as BN;
      // a year yyyy-02-29 in the the future, that is a leap year
      const timestampTest = await firstDateLike(nowTs, 'leap', 2, 29);
      // Act
      await time.increaseTo(timestampTest);
      await mockFlareDaemon.trigger();
      const {
        1: startTimeStamp,
        2: endTimeStamp } = await inflation.getCurrentTimeSlot() as any;
      // Assert
      assert.equal(endTimeStamp - startTimeStamp, 30 * 24 * 60 * 60 - 1);
    });
  });

  describe("authorize", async () => {
    it("Should not authorize inflation if no sharing percentages", async () => {
      // Assemble
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const { 0: authorizedInflation } = await inflation.getTotals();
      assert.equal(authorizedInflation.toNumber(), 0);
    });

    it("Should authorize inflation - first cycle, 1 sharing percentage", async () => {
      // Assemble
      // Set up one sharing percentage
      const sharingPercentages = [];
      const inflationReceiver = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: inflationReceiver.address, percentBips: 10000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      const response = await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      const { 0: actualAuthorizedInflation } = await inflation.getTotals();
      assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
      await expectEvent.inTransaction(response.tx, inflation, INFLATIONAUTHORIZED_EVENT, { amountWei: expectedAuthorizedInflation.toString() });
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT, { inflationReceiver: inflationReceiver.address, amountWei: expectedAuthorizedInflation.toString() });
    });

    it("Should authorize inflation - first cycle, 2 sharing percentages", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      sharingPercentages[0] = { inflationReceiver: (await MockContract.new()).address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: (await MockContract.new()).address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      const { 0: actualAuthorizedInflation } = await inflation.getTotals();
      // Check authorized inflation across time slots (only 1 time slot tho)
      assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check authorized inflation for first reward service
      assert.equal(rewardServicesState[0].authorizedInflationWei, Math.floor(expectedAuthorizedInflation * 0.3));
      // Check authorized inflation for the second reward service
      assert.equal(rewardServicesState[1].authorizedInflationWei, expectedAuthorizedInflation - Math.floor(expectedAuthorizedInflation * 0.3));
    });

    it("Should authorize inflation - first cycle, 3 sharing percentages", async () => {
      // Assemble
      // Set up three sharing percentages
      const sharingPercentages = [];
      sharingPercentages[0] = { inflationReceiver: (await MockContract.new()).address, percentBips: 3333 };
      sharingPercentages[1] = { inflationReceiver: (await MockContract.new()).address, percentBips: 3334 };
      sharingPercentages[2] = { inflationReceiver: (await MockContract.new()).address, percentBips: 3333 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      const { 0: actualAuthorizedInflation } = await inflation.getTotals();
      // Check authorized inflation across time slots (only 1 time slot tho)
      assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check authorized inflation for first reward service
      assert.equal(rewardServicesState[0].authorizedInflationWei, Math.floor(expectedAuthorizedInflation * 0.3333));
      // Check authorized inflation for second reward service
      assert.equal(rewardServicesState[1].authorizedInflationWei, Math.floor(expectedAuthorizedInflation * 0.3334));
      // Check authorized inflation for the third reward service
      assert.equal(rewardServicesState[2].authorizedInflationWei, expectedAuthorizedInflation - Math.floor(expectedAuthorizedInflation * 0.3334) - Math.floor(expectedAuthorizedInflation * 0.3333));
    });

    it("Should authorize inflation - second cycle, 2 sharing percentages", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      sharingPercentages[0] = { inflationReceiver: (await MockContract.new()).address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: (await MockContract.new()).address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflation = expectedAuthorizedInflationCycle1 + expectedAuthorizedInflationCycle2;
      const { 0: actualAuthorizedInflation } = await inflation.getTotals();
      // Check authorized inflation across time slots (only 1 time slot tho)
      assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
      // Compute authorized inflation total for cycle 2, each service
      const expectedAuthorizedInflationCycle2Service1 =
        Math.floor(expectedAuthorizedInflationCycle1 * 0.3) +
        Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
      const expectedAuthorizedInflationCycle2Service2 =
        expectedAuthorizedInflation -
        expectedAuthorizedInflationCycle2Service1;
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check authorized inflation for first reward service
      assert.equal(rewardServicesState[0].authorizedInflationWei, expectedAuthorizedInflationCycle2Service1);
      // Check authorized inflation for the second reward service
      assert.equal(rewardServicesState[1].authorizedInflationWei, expectedAuthorizedInflationCycle2Service2);
    });

    it("Should authorize inflation on rewarding service contract", async () => {
      // Assemble
      // Set up one sharing percentage
      const sharingPercentages = [];
      const rewardingServiceContract = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: rewardingServiceContract.address, percentBips: 10000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      const setDailyAuthorizedInflation = mockInflationReceiverInterface.contract.methods.setDailyAuthorizedInflation(expectedAuthorizedInflation).encodeABI();
      const invocationCount = await rewardingServiceContract.invocationCountForCalldata.call(setDailyAuthorizedInflation);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should call pre inflation calculation trigger method", async () => {
      // Assemble
      const preInflationCalculation = await MockContract.new();
      await inflation.setPreInflationCalculation(preInflationCalculation.address);
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const trigger = web3.utils.sha3("trigger()")!.slice(0, 10);
      const invocationCount = await preInflationCalculation.invocationCountForMethod.call(trigger);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should init new time slot even if more than 60 days (2 time slots) has passed since last flare daemon trigger", async () => {
      // Assemble
      await mockFlareDaemon.trigger(); // init first time slot
      expect((await inflation.getCurrentTimeSlotId()).toNumber()).to.equals(0);
      // Act
      await time.increase(2 * 30 * 24 * 60 * 60);
      // Assert
      await mockFlareDaemon.trigger(); // no revert - second time slot initialized
      expect((await inflation.getCurrentTimeSlotId()).toNumber()).to.equals(1);
    });

    it("Should revert if initialize the new time slot fails", async () => {
      const getTimeSlotPercentageBips = inflationAllocation.contract.methods.getTimeSlotPercentageBips().encodeABI();
      // const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
      await mockInflationPercentageProvider.givenMethodRevertWithMessage(getTimeSlotPercentageBips, "err");

      await expectRevert(mockFlareDaemon.trigger(), "err");
    });

    it("Should revert for a initialize the new time slot catch statement without a message", async () => {
      const getTimeSlotPercentageBips = inflationAllocation.contract.methods.getTimeSlotPercentageBips().encodeABI();
      // const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
      await mockInflationPercentageProvider.givenMethodRunOutOfGas(getTimeSlotPercentageBips);

      await expectRevert(mockFlareDaemon.trigger(), "unknown error. getTimeSlotPercentageBips");
    });

    it("Should revert if request minting fails", async () => {
      await mockFlareDaemon2.registerToDaemonize(inflation2.address);
      let tx = mockFlareDaemon2.trigger();
      await expectRevert(tx, "minting failed");
    });

    it("Should revert for a request minting catch statement without a message", async () => {
      await mockFlareDaemon1.registerToDaemonize(inflation1.address);
      let tx = mockFlareDaemon1.trigger();
      await expectRevert(tx, "unknown error. requestMinting");
    });

    it("Should revert if update inflatable balance and circulating supply fails", async () => {
      const update = web3.utils.sha3("updateAuthorizedInflationAndCirculatingSupply(uint256)")!.slice(0, 10);
      await mockSupply.givenMethodRevertWithMessage(update, "err");

      let tx = mockFlareDaemon.trigger();
      await expectRevert(tx, "err");
    });

    it("Should revert for a update inflatable balance and circulating supply catch statement without a message", async () => {
      const update = web3.utils.sha3("updateAuthorizedInflationAndCirculatingSupply(uint256)")!.slice(0, 10);
      await mockSupply.givenMethodRunOutOfGas(update);

      let tx = mockFlareDaemon.trigger();
      await expectRevert(tx, "unknown error. updateAuthorizedInflationAndCirculatingSupply");
    });

  });

  describe("topup", async () => {
    it("Should not topup inflation if no sharing percentages", async () => {
      // Assemble
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const { 1: topup } = await inflation.getTotals();
      assert.equal(topup.toNumber(), 0);
    });

    it("Should require topup factor greater than 1 (x100) if using daily authorized", async () => {
      // Assemble
      // Act
      const setPromise = inflation.setTopupConfiguration((await MockContract.new()).address, TopupType.FACTOROFDAILYAUTHORIZED, 100);
      // Require
      await expectRevert(setPromise, ERR_TOPUP_LOW);
    });

    it("Should disregard topup factor if using allauthorized", async () => {
      // Assemble
      // Act
      await inflation.setTopupConfiguration((await MockContract.new()).address, TopupType.ALLAUTHORIZED, 100);
      // Require

    });

    it("Should request inflation to topup - first cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const inflationReceiver0 = await MockContract.new();
      const inflationReceiver1 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: inflationReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: inflationReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      const response = await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedInflation * 0.3);
      const expectedTopupService1 = expectedAuthorizedInflation - expectedTopupService0;
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupRequestedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPCOMPUTED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupRequestedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPCOMPUTED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: expectedTopupService1.toString() });
      await expectEvent.inTransaction(response.tx, inflation, TOPUPREQUESTED_EVENT, { requestAmountWei: (expectedTopupService0 + expectedTopupService1).toString(), reRequestAmountWei: "0" });
    });

    it("Should request inflation to topup - second cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      const expectedTopupService = Math.floor(expectedAuthorizedInflation * 0.3);
      await receiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService);
      await receiver2.givenMethodReturnUint(getExpectedBalance, expectedAuthorizedInflation - expectedTopupService);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
      const expectedAuthorizedInflationCycle2Service2 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedInflationCycle2Service1 * 1.2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedInflationCycle2Service2 * 1.2);
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupRequestedWei, expectedTopupService1);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupRequestedWei, expectedTopupService2);
    });

    it("Should request inflation to topup - second cycle, 2 sharing percentages, by non default factor type", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await inflation.setTopupConfiguration(receiver1.address, TopupType.FACTOROFDAILYAUTHORIZED, 120);
      await inflation.setTopupConfiguration(receiver2.address, TopupType.FACTOROFDAILYAUTHORIZED, 110);
      await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
      const expectedAuthorizedInflationCycle2Service2 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedInflationCycle2Service1 * 1.2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedInflationCycle2Service2 * 1.1);
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupRequestedWei, expectedTopupService1);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupRequestedWei, expectedTopupService2);
    });

    it("Should request inflation to topup - second cycle, 2 sharing percentages, by mixed factor type", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: receiver1.address, percentBips: 2000 };
      sharingPercentages[1] = { inflationReceiver: receiver2.address, percentBips: 8000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await inflation.setTopupConfiguration(receiver1.address, TopupType.ALLAUTHORIZED, 0);
      await inflation.setTopupConfiguration(receiver2.address, TopupType.FACTOROFDAILYAUTHORIZED, 140);
      await mockFlareDaemon.trigger();
      await receiver1.givenMethodRevert(getExpectedBalance);
      await receiver2.givenMethodRunOutOfGas(getExpectedBalance);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 2000 / 10000);
      const expectedAuthorizedInflationCycle2Service2 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
      const expectedTopupService1 = Math.floor(expectedAuthorizedInflationCycle2Service1 * 2);
      const expectedTopupService2 = Math.floor(expectedAuthorizedInflationCycle2Service2 * 140 / 100);
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupRequestedWei, expectedTopupService1);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupRequestedWei, expectedTopupService2);
    });

    it("Should request inflation to topup - second cycle, 2 sharing percentages, for type all authorized", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const serviceReceiver1 = await MockContract.new();
      const serviceReceiver2 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: serviceReceiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: serviceReceiver2.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await inflation.setTopupConfiguration(serviceReceiver1.address, TopupType.ALLAUTHORIZED, 0);
      await inflation.setTopupConfiguration(serviceReceiver2.address, TopupType.ALLAUTHORIZED, 0);
      await mockFlareDaemon.trigger();
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(
        rewardServicesState[0].inflationTopupRequestedWei,
        rewardServicesState[0].authorizedInflationWei
      );
      // Check topup inflation for the second reward service
      assert.equal(
        rewardServicesState[1].inflationTopupRequestedWei,
        rewardServicesState[1].authorizedInflationWei
      );
    });

    it("Should not request inflation to topup if receiver has balance (getExpectedBalance method reverts)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const rewardServicesState1 = await inflation.getRewardServices() as any;
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedInflation * 0.3);
      const expectedTopupService1 = expectedAuthorizedInflation - expectedTopupService0;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState1[0].inflationTopupRequestedWei, expectedTopupService0);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState1[1].inflationTopupRequestedWei, expectedTopupService1);
      await receiver1.givenMethodRevert(getExpectedBalance);
      await receiver2.givenMethodRevert(getExpectedBalance);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      await web3.eth.sendTransaction({ from: accounts[0], to: receiver1.address, value: toBN(inflationForTimeSlot) });
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
      const expectedAuthorizedInflationCycle2Service2 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
      const expectedTopupService2 = Math.floor(expectedAuthorizedInflationCycle2Service2 * 1.2);
      const rewardServicesState2 = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState2[0].inflationTopupRequestedWei, expectedTopupService0);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState2[1].inflationTopupRequestedWei, expectedTopupService2);
    });

    it("Should request inflation to topup even if receiver has balance (self-destruct funds)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const receiver1 = await MockContract.new();
      const receiver2 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: receiver1.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: receiver2.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
      const rewardServicesState1 = await inflation.getRewardServices() as any;
      const expectedAuthorizedInflation = Math.floor(inflationForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedAuthorizedInflation * 0.3);
      const expectedTopupService1 = expectedAuthorizedInflation - expectedTopupService0;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState1[0].inflationTopupRequestedWei, expectedTopupService0);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState1[1].inflationTopupRequestedWei, expectedTopupService1);
      await receiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService0);
      await receiver2.givenMethodReturnUint(getExpectedBalance, expectedTopupService1);
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      await web3.eth.sendTransaction({ from: accounts[0], to: receiver1.address, value: toBN(inflationForTimeSlot) });
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
      const expectedAuthorizedInflationCycle2Service2 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
      const expectedTopupService0_2 = Math.floor(expectedAuthorizedInflationCycle2Service1 * 1.2);
      const expectedTopupService1_2 = Math.floor(expectedAuthorizedInflationCycle2Service2 * 1.2);
      const rewardServicesState2 = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState2[0].inflationTopupRequestedWei, expectedTopupService0_2);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState2[1].inflationTopupRequestedWei, expectedTopupService1_2);
    });

    it("Should revert if topup factor is less than 100 and topup type is FACTOROFDAILYAUTHORIZED", async() => {
      const receiver = await MockContract.new();
      const tx = inflation.setTopupConfiguration(receiver.address, TopupType.FACTOROFDAILYAUTHORIZED, 10);
      await expectRevert(tx, ERR_TOPUP_LOW);
    });

    it("Should return next expected inflation topup timestamp", async() => {
      // Inflation was not yet authorized
      let nextExpectedTopup0 = await inflation.contract.methods.getNextExpectedTopupTs().call({ from: accounts[0] });
      await inflation.getNextExpectedTopupTs();
      expect(nextExpectedTopup0).to.equals(DAY.toString());

      // Authorize inflation
      await mockFlareDaemon.trigger();
      let block = await web3.eth.getBlockNumber();
      let blockTs = (await web3.eth.getBlock(block)).timestamp as number;
      let nextExpectedTopup = await inflation.contract.methods.getNextExpectedTopupTs().call({ from: accounts[0] });
      await inflation.getNextExpectedTopupTs();
      expect(nextExpectedTopup).to.equals((blockTs + DAY).toString());

      // Only half a day passed. It is not yet a time to authorize new inflation.
      const nowTs = await time.latest() as BN;
      await time.increaseTo(nowTs.addn(0.5 * DAY));
      await mockFlareDaemon.trigger();
      let nextExpectedTopup1 = await inflation.contract.methods.getNextExpectedTopupTs().call({ from: accounts[0] });
      await inflation.getNextExpectedTopupTs();
      expect(nextExpectedTopup1).to.equals((blockTs + DAY).toString());
    });

  });

  describe("minting", async () => {
    it("Should request minting after a topup request is calculated", async () => {
      // Assemble
      // Set up one sharing percentage
      const sharingPercentages = [];
      const rewardingServiceContract = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: rewardingServiceContract.address, percentBips: 10000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const expectedRequestedInflation = Math.floor(inflationForTimeSlot / 30);
      const requestMinting = mockFlareDaemonInterface.contract.methods.requestMinting(expectedRequestedInflation).encodeABI();
      const invocationCount = await mockFlareDaemon.invocationCountForCalldata.call(requestMinting);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should receive toped up inflation - first cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const inflationReceiver0 = await MockContract.new();
      const inflationReceiver1 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: inflationReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: inflationReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      // Act
      const response = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
      // Assert
      const expectedReceivedInflation = Math.floor(inflationForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedReceivedInflation * 0.3);
      const expectedTopupService1 = expectedReceivedInflation - expectedTopupService0;
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupDistributedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: expectedTopupService1.toString() });

      // Running sum should be correct
      const { 2: receivedTopup } = await inflation.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
      await expectEvent.inTransaction(response.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0 + expectedTopupService1).toString() });
    });

    it("Should request minting and receive reduced topup - max minting limit", async () => {
      // Assemble
      const maxMintLimit = Math.floor(inflationForTimeSlot / 30);
      await mockFlareDaemon.givenMethodReturnUint(mockFlareDaemonInterface.contract.methods.maxMintingRequestWei().encodeABI(), maxMintLimit);
      // Set up two sharing percentages
      const sharingPercentages = [];
      const inflationReceiver0 = await MockContract.new();
      const inflationReceiver1 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: inflationReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: inflationReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      const response = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
      // Assert
      const expectedReceivedInflation = Math.floor(inflationForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedReceivedInflation * 0.3);
      const expectedTopupService1 = expectedReceivedInflation - expectedTopupService0;
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupDistributedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: expectedTopupService1.toString() });
      // Running sum should be correct
      const { 2: receivedTopup } = await inflation.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
      await expectEvent.inTransaction(response.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0 + expectedTopupService1).toString() });

      await inflationReceiver0.givenMethodReturnUint(getExpectedBalance, expectedTopupService0);
      await inflationReceiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService1);
      // second day
      const inflationReceiver2 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: inflationReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: inflationReceiver2.address, percentBips: 7000 };
      const percentageProviderMock2 = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock2.address], {from: ADDRESS_UPDATER});

      const nowTs = await time.latest() as BN;
      await time.increaseTo(nowTs.addn(86400));
      await mockFlareDaemon.trigger();
      const { 1: toMint2 } = await inflation.getTotals();
      const response2 = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint2.sub(toMint) });

      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
      const expectedAuthorizedInflationCycle2Service3 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
      const expectedTopupService0_2 = Math.floor(expectedAuthorizedInflationCycle2Service1 * 1.2) - expectedTopupService0;
      const expectedTopupService2_2 = expectedAuthorizedInflationCycle2Service3;

      // Running sum should be correct
      const { 2: receivedTopup_2 } = await inflation.getTotals();
      assert.equal(receivedTopup_2.toNumber(), expectedTopupService0 + expectedTopupService1 + expectedTopupService0_2 + expectedTopupService2_2);
      await expectEvent.inTransaction(response2.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0_2 + expectedTopupService2_2).toString() });
      const rewardServicesState_2 = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState_2[0].inflationTopupDistributedWei, expectedTopupService0 + expectedTopupService0_2);
      await expectEvent.inTransaction(response2.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0_2.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState_2[1].inflationTopupDistributedWei, expectedTopupService1);
      // Check topup inflation for the third reward service
      assert.equal(rewardServicesState_2[2].inflationTopupDistributedWei, expectedTopupService2_2);
      await expectEvent.inTransaction(response2.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver2.address, amountWei: expectedTopupService2_2.toString() });

      // Act
      // change topup factor
      await inflation.setTopupConfiguration(inflationReceiver0.address, TopupType.ALLAUTHORIZED, 0);
      await inflation.setTopupConfiguration(inflationReceiver1.address, TopupType.ALLAUTHORIZED, 0);
      await inflation.setTopupConfiguration(inflationReceiver2.address, TopupType.ALLAUTHORIZED, 0);

      await inflationReceiver0.givenMethodReturnUint(getExpectedBalance, expectedTopupService0 + expectedTopupService0_2);
      await inflationReceiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService1);
      await inflationReceiver2.givenMethodReturnUint(getExpectedBalance, expectedTopupService2_2);
      // third day
      await time.increaseTo(nowTs.addn(2 * 86400));
      const response3 = await mockFlareDaemon.trigger();
      const { 1: toMint3 } = await inflation.getTotals();
      const response4 = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint3.sub(toMint2) });

      // Assert
      assert.equal(toMint3.sub(toMint2).toString(), maxMintLimit.toString());
      const expectedAuthorizedInflationCycle3 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1 - expectedAuthorizedInflationCycle2) / 28);
      const expectedAuthorizedInflationCycle3Service1 = Math.floor(expectedAuthorizedInflationCycle3 * 0.3);
      const expectedAuthorizedInflationCycle3Service3 = expectedAuthorizedInflationCycle3 - expectedAuthorizedInflationCycle3Service1;
      // This should cap at max mint
      const calculatedTopup = expectedAuthorizedInflationCycle1 + expectedAuthorizedInflationCycle2 + expectedAuthorizedInflationCycle3 - receivedTopup_2.toNumber();
      assert(calculatedTopup > maxMintLimit);
      const calculatedTopupService0_3 = expectedAuthorizedInflationCycle3Service1 + expectedAuthorizedInflationCycle2Service1 - expectedTopupService0_2;
      const expectedTopupService0_3 = calculatedTopupService0_3 - Math.ceil(calculatedTopupService0_3 * (calculatedTopup - maxMintLimit) / calculatedTopup);
      const expectedTopupService2_3 = maxMintLimit - expectedTopupService0_3;
      const rewardServicesState_3 = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState_3[0].inflationTopupDistributedWei, expectedTopupService0_3 + expectedTopupService0_2 + expectedTopupService0);
      await expectEvent.inTransaction(response3.tx, inflation, REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedAuthorizedInflationCycle3Service1.toString() });
      await expectEvent.inTransaction(response4.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0_3.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState_3[1].inflationTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response4.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: "0" });
      // Check topup inflation for the third reward service
      assert.equal(rewardServicesState_3[2].inflationTopupDistributedWei, expectedTopupService2_3 + expectedTopupService2_2);
      await expectEvent.inTransaction(response3.tx, inflation, REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT, { inflationReceiver: inflationReceiver2.address, amountWei: expectedAuthorizedInflationCycle3Service3.toString() });
      await expectEvent.inTransaction(response4.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver2.address, amountWei: expectedTopupService2_3.toString() });

      // Running sum should be correct
      const { 2: receivedTopup_3 } = await inflation.getTotals();
      assert.equal(receivedTopup_3.toNumber(), expectedTopupService0 + expectedTopupService1 + expectedTopupService0_2 + expectedTopupService2_2 + expectedTopupService0_3 + expectedTopupService2_3);
      await expectEvent.inTransaction(response4.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0_3 + expectedTopupService2_3).toString() });
    });

    it("Should request minting and receive topup even if authorized in previous time slot", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const inflationReceiver0 = await MockContract.new();
      const inflationReceiver1 = await MockContract.new();
      sharingPercentages[0] = { inflationReceiver: inflationReceiver0.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: inflationReceiver1.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      const response = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
      // Assert
      const expectedReceivedInflation = Math.floor(inflationForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedReceivedInflation * 0.3);
      const expectedTopupService1 = expectedReceivedInflation - expectedTopupService0;
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupDistributedWei, expectedTopupService0);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupDistributedWei, expectedTopupService1);
      await expectEvent.inTransaction(response.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: expectedTopupService1.toString() });
      // Running sum should be correct
      const { 2: receivedTopup } = await inflation.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
      await expectEvent.inTransaction(response.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0 + expectedTopupService1).toString() });

      await inflationReceiver0.givenMethodReturnUint(getExpectedBalance, expectedTopupService0);
      await inflationReceiver1.givenMethodReturnUint(getExpectedBalance, expectedTopupService1);
      // second day
      const nowTs = await time.latest() as BN;
      // A day passes...
      await time.increaseTo(nowTs.addn(86400));
      await mockFlareDaemon.trigger();
      const { 1: toMint2 } = await inflation.getTotals();
      const response2 = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint2.sub(toMint) });

      const expectedAuthorizedInflationCycle1 = Math.floor(inflationForTimeSlot / 30);
      const expectedAuthorizedInflationCycle2 = Math.floor((inflationForTimeSlot - expectedAuthorizedInflationCycle1) / 29);
      const expectedAuthorizedInflationCycle2Service1 = Math.floor(expectedAuthorizedInflationCycle2 * 0.3);
      const expectedAuthorizedInflationCycle2Service2 = expectedAuthorizedInflationCycle2 - expectedAuthorizedInflationCycle2Service1;
      const expectedTopupService0_2 = Math.floor(expectedAuthorizedInflationCycle2Service1 * 1.2) - expectedTopupService0;
      const expectedTopupService1_2 = Math.floor(expectedAuthorizedInflationCycle2Service2 * 1.2) - expectedTopupService1;

      // Running sum should be correct
      const { 2: receivedTopup_2 } = await inflation.getTotals();
      assert.equal(receivedTopup_2.toNumber(), expectedTopupService0 + expectedTopupService1 + expectedTopupService0_2 + expectedTopupService1_2);
      await expectEvent.inTransaction(response2.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0_2 + expectedTopupService1_2).toString() });
      const rewardServicesState_2 = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState_2[0].inflationTopupDistributedWei, expectedTopupService0 + expectedTopupService0_2);
      await expectEvent.inTransaction(response2.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0_2.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState_2[1].inflationTopupDistributedWei, expectedTopupService1 + expectedTopupService1_2);
      await expectEvent.inTransaction(response2.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: expectedTopupService1_2.toString() });

      // Act
      // change topup factor
      await inflation.setTopupConfiguration(inflationReceiver0.address, TopupType.ALLAUTHORIZED, 0);
      await inflation.setTopupConfiguration(inflationReceiver1.address, TopupType.ALLAUTHORIZED, 0);
      // a month passes...
      await time.increaseTo((await inflation.getCurrentTimeSlot()).endTimeStamp);
      await time.advanceBlock();
      const response3 = await mockFlareDaemon.trigger();
      const { 1: toMint3 } = await inflation.getTotals();

      // 2 months minus what was already authorized
      const expectedAuthorizedInflation_1 = Math.floor((inflationForTimeSlot * 2 - expectedAuthorizedInflationCycle1 - expectedAuthorizedInflationCycle2) / 30);
      // Assert
      const expectedAuthorizedService0_3 = Math.floor(expectedAuthorizedInflation_1 * 0.3);
      const expectedAuthorizedService1_3 = expectedAuthorizedInflation_1 - expectedAuthorizedService0_3;
      const response4 = await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint3.sub(toMint2) });
      // This should cap at all days authorization...not the daily one
      const expectedTopupService0_3 = expectedAuthorizedService0_3 + expectedAuthorizedInflationCycle2Service1 - expectedTopupService0_2;
      const expectedTopupService1_3 = expectedAuthorizedService1_3 + expectedAuthorizedInflationCycle2Service2 - expectedTopupService1_2;
      const rewardServicesState_3 = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState_3[0].inflationTopupDistributedWei, expectedTopupService0_3 + expectedTopupService0_2 + expectedTopupService0);
      await expectEvent.inTransaction(response3.tx, inflation, REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedAuthorizedService0_3.toString() });
      await expectEvent.inTransaction(response4.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver0.address, amountWei: expectedTopupService0_3.toString() });
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState_3[1].inflationTopupDistributedWei, expectedTopupService1_3 + expectedTopupService1_2 + expectedTopupService1);
      await expectEvent.inTransaction(response3.tx, inflation, REWARDSERVICEDAILYAUTHORIZEDINFLATIONCOMPUTED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: expectedAuthorizedService1_3.toString() });
      await expectEvent.inTransaction(response4.tx, inflation, REWARDSERVICETOPUPREQUESTRECEIVED_EVENT, { inflationReceiver: inflationReceiver1.address, amountWei: expectedTopupService1_3.toString() });
      // Running sum should be correct
      const { 2: receivedTopup_3 } = await inflation.getTotals();
      assert.equal(receivedTopup_3.toNumber(), expectedTopupService0 + expectedTopupService1 + expectedTopupService0_2 + expectedTopupService1_2 + expectedTopupService0_3 + expectedTopupService1_3);
      await expectEvent.inTransaction(response4.tx, inflation, MINTINGRECEIVED_EVENT, { amountWei: (expectedTopupService0_3 + expectedTopupService1_3).toString() });
    });
  });

  describe("funding", async () => {

    it("Should not reward before start time", async () => {
      // Assemble
      // We must create non default inflation, since default has rewardEpoch at 0
      mockSupply = await MockContract.new();
      mockInflationPercentageProvider = await MockContract.new();
      mockFlareDaemon = await FlareDaemonMock.new();

      const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0, 10); // first 4 bytes is function selector
      const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
      await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
      await mockInflationPercentageProvider.givenMethodReturnUint(getTimeSlotPercentageBips, inflationBips);

      await time.advanceBlock();
      const latest = await time.latest();

      inflation = await Inflation.new(
        accounts[0],
        mockFlareDaemon.address,
        ADDRESS_UPDATER,
        latest.toNumber() + 2 * 86400 // Set time sometime after now, but at least two days to trigger new inflation if not exiting preemptively
      );

      const tx = await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, mockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.registerToDaemonize(inflation.address);

      // Act
      await mockFlareDaemon.trigger();
      // Assert
      // It should return directly and not change lastAuthorizationTs
      const lastTs = await inflation.lastAuthorizationTs();
      assert.equal(lastTs.toNumber(), 0);
      expectEvent(tx, SUPPLYSET_EVENT, { oldSupply: constants.ZERO_ADDRESS, newSupply: mockSupply.address });
    });

    it("Should fund toped up inflation - first cycle, 2 sharing percentages, by factor type (default)", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const rewardingServiceContract0 = await InflationReceiverMock.new();
      const rewardingServiceContract1 = await InflationReceiverMock.new();
      sharingPercentages[0] = { inflationReceiver: rewardingServiceContract0.address, percentBips: 3000 };
      sharingPercentages[1] = { inflationReceiver: rewardingServiceContract1.address, percentBips: 7000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      // Act
      await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
      // Assert
      const expectedInflationFunded = Math.floor(inflationForTimeSlot / 30);
      // This should cap at one days authorization...not the factor
      const expectedTopupService0 = Math.floor(expectedInflationFunded * 0.3);
      const expectedTopupService1 = expectedInflationFunded - expectedTopupService0;
      const rewardServicesState = await inflation.getRewardServices() as any;
      // Check topup inflation for first reward service
      assert.equal(rewardServicesState[0].inflationTopupDistributedWei, expectedTopupService0);
      // Check topup inflation for the second reward service
      assert.equal(rewardServicesState[1].inflationTopupDistributedWei, expectedTopupService1);
      // Running sum should be correct
      const { 2: receivedTopup } = await inflation.getTotals();
      assert.equal(receivedTopup.toNumber(), expectedTopupService0 + expectedTopupService1);
      // Check that target reward service contracts got the native token they are due
      assert.equal((await web3.eth.getBalance(rewardingServiceContract0.address)), expectedTopupService0.toString());
      assert.equal((await web3.eth.getBalance(rewardingServiceContract1.address)), expectedTopupService1.toString());
    });

    it("Should balance while receiving self-destruct proceeds", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const rewardingServiceContract0 = await InflationReceiverMock.new();
      sharingPercentages[0] = { inflationReceiver: rewardingServiceContract0.address, percentBips: 10000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      const openingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      // Act
      // Sneak in 1 more to simulate self-destructing
      await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint.addn(1) });
      // ...and if it got here, then we balance.
      const closingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      // Assert
      // Check self destruct bucket for good measure...
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 1);
    });

    it("Should balance when receiving self-destruct amount between daemonize calls", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const rewardingServiceContract0 = await InflationReceiverMock.new();
      sharingPercentages[0] = { inflationReceiver: rewardingServiceContract0.address, percentBips: 10000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      // Act
      // Self destruct with some native
      const suicidalMock = await SuicidalMock.new(inflation.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: toBN(5) });
      // Attacker dies
      await suicidalMock.die();
      const openingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint });
      const closingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      // ...and if it got here, then we balance.
      // Assert
      // Check self destruct bucket for good measure...
      // Should record self destruct value
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 5);
    });

    it("Should balance when receiving self-destruct outside between daemonize calls", async () => {
      // Assemble
      // Set up two sharing percentages
      const sharingPercentages = [];
      const rewardingServiceContract0 = await InflationReceiverMock.new();
      sharingPercentages[0] = { inflationReceiver: rewardingServiceContract0.address, percentBips: 10000 };
      const percentageProviderMock = await PercentageProviderMock.new(sharingPercentages, inflationBips);
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, percentageProviderMock.address], {from: ADDRESS_UPDATER});
      // Prime topup request buckets
      await mockFlareDaemon.trigger();
      const { 1: toMint } = await inflation.getTotals();
      // Act
      // Self destruct with some native
      const suicidalMock = await SuicidalMock.new(inflation.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({ from: accounts[0], to: suicidalMock.address, value: toBN(5) });
      // Attacker dies
      await suicidalMock.die();

      const openingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      await mockFlareDaemon.callReceiveMinting(inflation.address, { value: toMint.addn(1) });
      const closingBalance = toBN(await web3.eth.getBalance(BURN_ADDRESS));
      // ...and if it got here, then we balance.
      // Assert
      // Check self destruct bucket for good measure...
      // Should record both self destruct and additional value
      assert.equal(closingBalance.sub(openingBalance).toNumber(), 5 + 1);
    });

    it("Should record timestamp of the block where daemonize started in rewardEpochStartedTs when rewards started after 0", async () => {
      // Assemble
      mockSupply = await MockContract.new();
      mockInflationPercentageProvider = await MockContract.new();
      mockFlareDaemon = await FlareDaemonMock.new();

      const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0, 10); // first 4 bytes is function selector
      const getTimeSlotPercentageBips = web3.utils.sha3("getTimeSlotPercentageBips()")!.slice(0, 10);
      await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
      await mockInflationPercentageProvider.givenMethodReturnUint(getTimeSlotPercentageBips, inflationBips);

      await time.advanceBlock();
      const latest = await time.latest();
      inflation = await Inflation.new(
        accounts[0],
        mockFlareDaemon.address,
        ADDRESS_UPDATER,
        latest // Set time to now
      );

      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, mockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});
      await mockFlareDaemon.registerToDaemonize(inflation.address);
      const rewardTime = (await time.latest()).addn(86400); // Initiate daemonize some time after the reward start time
      await time.increaseTo(rewardTime);
      // Act
      await mockFlareDaemon.trigger();
      // Assert
      const lastTs = (await inflation.rewardEpochStartedTs()).toNumber();

      assert.isTrue(lastTs <= rewardTime.toNumber() + 5 && lastTs >= rewardTime.toNumber()); // CI is SLOW. Allow for some slop.
    });

  });

  describe("helper methods", async () => {
    it("Should get a time slot by index", async () => {
      // Assemble
      await mockFlareDaemon.trigger();
      // Act
      const { recognizedInflationWei } = await inflation.getTimeSlot(0);
      // Assert
      assert.equal(recognizedInflationWei, BN(inflationForTimeSlot));
    });

    it("Should set InflationAllocation", async () => {
      // Assemble
      const newMockInflationPercentageProvider = await MockContract.new();

      // Act
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, newMockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});

      // Assert
      assert.equal((await inflation.inflationAllocation()), newMockInflationPercentageProvider.address);
    });

    it("Should reject InflationAllocation change if not from address updater", async () => {
      // Assemble
      const newMockInflationPercentageProvider = await MockContract.new();

      // Act
      const changePromise = inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, newMockInflationPercentageProvider.address], {from: accounts[2]});

      // Assert
      await expectRevert(changePromise, "only address updater");
      assert.equal((await inflation.inflationAllocation()), mockInflationPercentageProvider.address);
    });

    it("Should reject InflationPercentageProvider change with 0 address", async () => {
      // Assemble

      // Act
      const changePromise = inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, mockSupply.address, constants.ZERO_ADDRESS], {from: ADDRESS_UPDATER});

      // Assert
      await expectRevert(changePromise, "address zero");
      assert.equal((await inflation.inflationAllocation()), mockInflationPercentageProvider.address);
    });

    it("Should set new supply", async () => {
      // Assemble

      const newMockSupply = await MockContract.new();

      // Act
      await inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
        [ADDRESS_UPDATER, newMockSupply.address, mockInflationPercentageProvider.address], {from: ADDRESS_UPDATER});

      // Assert
      assert.equal((await inflation.supply()), newMockSupply.address);

    });

    it("Should reject supply change if not from governed", async () => {
      // Assemble
      const newMockSupply = await MockContract.new();

      // Act
      const changePromise = inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, newMockSupply.address], {from: accounts[2]});

      // Assert
      await expectRevert(changePromise, "only address updater");
      assert.equal((await inflation.supply()), mockSupply.address);
    });

    it("Should reject supply with 0 address", async () => {
      // Assemble

      // Act
      const changePromise = inflation.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, constants.ZERO_ADDRESS], {from: ADDRESS_UPDATER});

      // Assert
      await expectRevert(changePromise, "address zero");
      assert.equal((await inflation.supply()), mockSupply.address);
    });

    it("Should not allow setting pre inflation calculation contract if not from governance", async () => {
      // Assemble
      // Act
      const setPromise = inflation.setPreInflationCalculation((await MockContract.new()).address, { from: accounts[2] });
      // Require
      await expectRevert(setPromise, ONLY_GOVERNANCE_MSG);
    });

    it("Should not allow topup configuration change if not from governance", async () => {
      // Assemble
      // Act
      const setPromise = inflation.setTopupConfiguration((await MockContract.new()).address, TopupType.ALLAUTHORIZED, 100, { from: accounts[2] });
      // Require
      await expectRevert(setPromise, ONLY_GOVERNANCE_MSG);
    });

    it("Should not allow topup configuration change with 0 address", async () => {
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
      const t1Result = await inflation.getTopupConfiguration(mockInflation1.address);
      assert.equal(t1Result.configured, true);
      assert.equal(t1Result.topupType, BN(t1Type));
      assert.equal(t1Result.topupFactorX100, BN(t1Factor));
      // t2 and 3 should be default
      const t2ResultDefault = await inflation.getTopupConfiguration(mockInflation2.address);
      assert.equal(t2ResultDefault.configured, false);
      assert.equal(t2ResultDefault.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t2ResultDefault.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      const t3Result = await inflation.getTopupConfiguration(mockInflation3.address);
      assert.equal(t3Result.configured, false);
      assert.equal(t3Result.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      // Adding another should not change previous
      // Act
      await inflation.setTopupConfiguration(mockInflation2.address, t2Type, t2Factor);
      const t1Result2 = await inflation.getTopupConfiguration(mockInflation1.address);
      assert.equal(t1Result2.configured, true);
      assert.equal(t1Result2.topupType, BN(t1Type));
      assert.equal(t1Result2.topupFactorX100, BN(t1Factor));
      const t2Result = await inflation.getTopupConfiguration(mockInflation2.address);
      assert.equal(t2Result.configured, true);
      assert.equal(t2Result.topupType, BN(t2Type));
      assert.equal(t2Result.topupFactorX100, BN(t2Factor));
      const t3Result2 = await inflation.getTopupConfiguration(mockInflation3.address);
      assert.equal(t3Result2.configured, false);
      assert.equal(t3Result2.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result2.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

      // Can update multiple times
      await inflation.setTopupConfiguration(mockInflation2.address, t2TypeFinal, t2FactorFinal);
      const t1Result3 = await inflation.getTopupConfiguration(mockInflation1.address);
      assert.equal(t1Result3.configured, true);
      assert.equal(t1Result3.topupType, BN(t1Type));
      assert.equal(t1Result3.topupFactorX100, BN(t1Factor));
      const t2ResultFinal = await inflation.getTopupConfiguration(mockInflation2.address);
      assert.equal(t2ResultFinal.configured, true);
      assert.equal(t2ResultFinal.topupType, BN(t2TypeFinal));
      assert.equal(t2ResultFinal.topupFactorX100, BN(t2FactorFinal));
      const t3Result3 = await inflation.getTopupConfiguration(mockInflation3.address);
      assert.equal(t3Result3.configured, false);
      assert.equal(t3Result3.topupType, BN(TopupType.FACTOROFDAILYAUTHORIZED));
      assert.equal(t3Result3.topupFactorX100, BN(DEFAULT_TOPUP_FACTOR_X100));

    });

    it("Should return contract name", async () => {
      expect(await inflation.getContractName()).to.equals(Contracts.INFLATION);
    });

  });

  // there is no fallback mode in Inflation
  describe("fallback mode", async () => {
    it("Should not switch to fallback mode", async () => {
      let switchTo = await mockFlareDaemon.contract.methods.fallbackTest(inflation.address).call();
      let result = switchTo.slice(64, 66); // last byte
      let sw = Boolean(parseInt(result, 16));
      assert(!sw);
    });
  });

});
