import { GovernedAtGenesisInstance } from "../../../typechain-truffle";

const {constants, expectRevert, expectEvent} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const GovernedAtGenesis = artifacts.require("GovernedAtGenesis");

const ALREADY_INIT_MSG = "initialised != false";

contract(`GovernedAtGenesis.sol; ${getTestFile(__filename)};`, async accounts => {
  // contains a fresh contract for each test
  let governedAtGenesis: GovernedAtGenesisInstance;

  beforeEach(async() => {
    governedAtGenesis = await GovernedAtGenesis.new(constants.ZERO_ADDRESS);
  });

  describe("initialise", async() => {
    it("Should not initialize with a specifiable governance address", async() => {
      // Assemble
      // Act
      let initializePromise = governedAtGenesis.initialise(accounts[1]);
      // Assert
      await expectRevert.assertion(initializePromise);
    });

    it("Should initialize with a fixed governance address", async() => {
      // Assemble
      // Act
      await governedAtGenesis.initialiseFixedAddress();
      // Assert
      let governedAddress = await governedAtGenesis.governance();
      assert.notEqual(governedAddress, constants.ZERO_ADDRESS);
    });  

    it("Should not initialize twice", async() => {
      // Assemble
      await governedAtGenesis.initialiseFixedAddress();
      // Act
      let initializePromise = governedAtGenesis.initialiseFixedAddress();
      // Assert
      await expectRevert(initializePromise, ALREADY_INIT_MSG);
    });      
  });
});