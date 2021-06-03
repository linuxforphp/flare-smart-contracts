import { BokkyPooBahsDateTimeContractInstance } from "../../../typechain-truffle";

const getTestFile = require('../../utils/constants').getTestFile;

const DateTimeContract = artifacts.require("BokkyPooBahsDateTimeContract");

contract(`DateTimeLibrary.sol; ${getTestFile(__filename)}; DateTimeLibrary unit tests`, async accounts => {
  // let BokkyPooBahsDateTimeLibrary: BokkyPooBahsDateTimeLibraryInstance;
  let dateTimeContract: BokkyPooBahsDateTimeContractInstance;

  beforeEach(async() => {
    dateTimeContract = await DateTimeContract.new()
  });

  it("Shoud check if date 0 is 01.01.1970 ", async() => {
    // Assemble
    let day_zero = await dateTimeContract._daysFromDate(1970,1,1)
    // Act
  
    // Assert
    assert.equal(day_zero.toNumber(), 0);
  });

  it("Test leap year ", async() => {
    // Assemble
    // Devisable by 400
    let timestamp_1 = await dateTimeContract.timestampFromDateTime(2000, 6, 30, 1, 2, 3);
    // Devisable by 100 but not by 400
    let timestamp_2 = await dateTimeContract.timestampFromDateTime(2100, 6, 30, 1, 2, 3);
    let timestamp_3 = await dateTimeContract.timestampFromDateTime(2200, 6, 30, 1, 2, 3);
    let timestamp_4 = await dateTimeContract.timestampFromDateTime(2300, 6, 30, 1, 2, 3);
    // Devisable by 4 but not by 100
    let timestamp_5 = await dateTimeContract.timestampFromDateTime(2104, 6, 30, 1, 2, 3);
    let timestamp_6 = await dateTimeContract.timestampFromDateTime(2016, 6, 30, 1, 2, 3);
    // Not devisable by 4
    let timestamp_7 = await dateTimeContract.timestampFromDateTime(1995, 6, 30, 1, 2, 3);
    let timestamp_8 = await dateTimeContract.timestampFromDateTime(2021, 6, 30, 1, 2, 3);
    
    // Act
    let leap_check_1 = await dateTimeContract.isLeapYear(timestamp_1);
    let leap_check_2 = await dateTimeContract.isLeapYear(timestamp_2);
    let leap_check_3 = await dateTimeContract.isLeapYear(timestamp_3);
    let leap_check_4 = await dateTimeContract.isLeapYear(timestamp_4);
    let leap_check_5 = await dateTimeContract.isLeapYear(timestamp_5);
    let leap_check_6 = await dateTimeContract.isLeapYear(timestamp_6);
    let leap_check_7 = await dateTimeContract.isLeapYear(timestamp_7);
    let leap_check_8 = await dateTimeContract.isLeapYear(timestamp_8);
    
    // Assert
    assert.equal(leap_check_1, true);
    assert.equal(leap_check_2, false);
    assert.equal(leap_check_3, false);
    assert.equal(leap_check_4, false);
    assert.equal(leap_check_5, true);
    assert.equal(leap_check_6, true);
    assert.equal(leap_check_7, false);
    assert.equal(leap_check_8, false);
  });

  // wip add other from lib TODO
});