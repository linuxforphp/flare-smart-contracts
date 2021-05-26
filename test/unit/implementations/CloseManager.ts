import { 
  MockContractInstance, 
  CloseManagerInstance} from "../../../typechain-truffle";

const {expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const CloseManager = artifacts.require("CloseManager");
const MockContract = artifacts.require("MockContract");

const ERR_TOO_MANY = "too many";
const ERR_CONTRACT_NOT_FOUND = "contract not found";
const ERR_NO_CLOSING_PERIODS = "no periods";
const ERR_BEFORE_FIRST_CLOSE = "before first close";
const ERR_ONLY_GOVERNANCE = "only governance";

const BN = web3.utils.toBN;

contract(`CloseManager.sol; ${getTestFile(__filename)}; Close manager unit tests`, async accounts => {
  // contains a fresh contract for each test
  let closeManager: CloseManagerInstance;
  let mockCloseable: MockContractInstance;
  let startTs: BN;

  beforeEach(async() => {
    closeManager = await CloseManager.new(accounts[0]);
    mockCloseable = await MockContract.new();
    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();
  });

  describe("getters", async() => {
    it("Should not get a closing period if none exist", async() => {
      // Assemble
      // Act
      const getPromise = closeManager.getClosingPeriodAsOf(0);
      // Assert
      await expectRevert(getPromise, ERR_NO_CLOSING_PERIODS);
    });

    it("Should not get a closing period if before first close", async() => {
      // Assemble
      // Pump keep to get internals primed for a roll
      await closeManager.keep();
      // Time travel two hours and one second to simulate some hours passing
      await time.increaseTo(startTs.addn(7201));
      await closeManager.keep();
      // Time travel to tomorrow
      await time.increaseTo(startTs.addn(86400));
      // This should trigger a close
      await closeManager.keep();

      // Act
      const getPromise = closeManager.getClosingPeriodAsOf(startTs);
      
      // Assert
      await expectRevert(getPromise, ERR_BEFORE_FIRST_CLOSE);
    });

    it("Should get a closing period", async() => {
      // Assemble
      // Pump keep to get internals primed for a roll
      await closeManager.keep();
      // Time travel two hours and one second to simulate some hours passing
      await time.increaseTo(startTs.addn(7201));
      await closeManager.keep();
      // Time travel to tomorrow
      await time.increaseTo(startTs.addn(86400));
      // This should trigger a close
      await closeManager.keep();

      // Act
      const {0: blockNumber, 1: timestamp} = await closeManager.getClosingPeriodAsOf(startTs.addn(86400 + 1));
      
      // Assert
      assert(blockNumber.gt(BN(0)), "No closing block");
      assert(timestamp.lte(startTs.addn(86400 + 1)), "Timestamp not lte asked for");
    });
  });

  describe("register", async() => {
    it("Should register a closable", async() => {
      // Assemble
      // Act
      await closeManager.registerToClose(mockCloseable.address);
      // Assert
      const address = await closeManager.closeables(0);
      assert.equal(address, mockCloseable.address);
    });

    it("Should not register a closable if not governance", async() => {
      // Assemble
      // Act
      const registerPromise = closeManager.registerToClose(mockCloseable.address, {from: accounts[1]});
      // Assert
      await expectRevert(registerPromise, ERR_ONLY_GOVERNANCE);
    });

    it("Should not register a closable if too many", async() => {
      // Assemble
      for(let i = 0; i < 19; i++) {
        await closeManager.registerToClose((await MockContract.new()).address);
      }
      // Act
      const registerPromise = closeManager.registerToClose(mockCloseable.address);
      // Assert
      await expectRevert(registerPromise, ERR_TOO_MANY);
    });    

    it("Should not register a duplicate closable", async() => {
      // Assemble
      await closeManager.registerToClose(mockCloseable.address);
      // Act
      await closeManager.registerToClose(mockCloseable.address);
      // Assert
      const getPromise = closeManager.closeables(1);
      await expectRevert.unspecified(getPromise);
    });    
  });

  describe("unregister", async() => {
    it("Should unregister a closable", async() => {
      // Assemble
      await closeManager.registerToClose(mockCloseable.address);
      // Act
      await closeManager.unregisterToClose(mockCloseable.address);
      // Assert
      const getPromise = closeManager.closeables(1);
      await expectRevert.unspecified(getPromise);
    });

    it("Should not unregister a closable if not governance", async() => {
      // Assemble
      await closeManager.registerToClose(mockCloseable.address);
      // Act
      const unregisterPromise = closeManager.unregisterToClose(mockCloseable.address, {from: accounts[1]});
      // Assert
      await expectRevert(unregisterPromise, ERR_ONLY_GOVERNANCE);
      const address = await closeManager.closeables(0);
      assert.equal(address, mockCloseable.address);
    });

    it("Should not unregister a closable not already registered", async() => {
      // Assemble
      // Act
      const unregisterPromise = closeManager.unregisterToClose(mockCloseable.address);
      // Assert
      await expectRevert(unregisterPromise, ERR_CONTRACT_NOT_FOUND);
    });
  });

  describe("keep", async() => {
    it("Should close closeables if closing period rolls over", async() => {
      // Assemble
      const close = web3.utils.sha3("close()")!.slice(0,10); // first 4 bytes is function selector
      await closeManager.registerToClose(mockCloseable.address);
      // Pump keep to get internals primed for a roll
      await closeManager.keep();
      // Time travel two hours and one second to simulate some hours passing
      await time.increaseTo(startTs.addn(7201));
      await closeManager.keep();
      // Time travel to tomorrow
      await time.increaseTo(startTs.addn(86400));

      // Act
      // This should trigger a close
      await closeManager.keep();

      // Assert
      assert((await mockCloseable.invocationCountForMethod.call(close)).eq(BN(1)));
    });

    it("Should log error for closeable closing in error when closing period rolls over", async() => {
      // Assemble
      const close = web3.utils.sha3("close()")!.slice(0,10); // first 4 bytes is function selector
      await mockCloseable.givenMethodRevertWithMessage(close, "I reverted");
      await closeManager.registerToClose(mockCloseable.address);
      // Pump keep to get internals primed for a roll
      await closeManager.keep();
      // Time travel two hours and one second to simulate some hours passing
      await time.increaseTo(startTs.addn(7201));
      await closeManager.keep();
      // Time travel to tomorrow
      await time.increaseTo(startTs.addn(86400));

      // Act
      // This should trigger a close
      await closeManager.keep();

      // Assert
      const currentBlock = BN(await web3.eth.getBlockNumber());
      const { 0: closable, 1: message} = await closeManager.errorsByBlock(currentBlock, 0);
      assert.equal(closable, mockCloseable.address);
      assert.equal(message, "I reverted");
    });

    it("Should add a closing period when period rolls over", async() => {
      // Assemble
      // Pump keep to get internals primed for a roll
      await closeManager.keep();
      // Time travel two hours and one second to simulate some hours passing
      await time.increaseTo(startTs.addn(7201));
      await closeManager.keep();
      // Time travel to tomorrow
      await time.increaseTo(startTs.addn(86400));
      // This should trigger a close
      await closeManager.keep();

      // Act
      const {0: blockNumber, 1: timestamp} = await closeManager.closingPeriods(0);
      
      // Assert
      const currentBlock = BN(await web3.eth.getBlockNumber());
      assert(blockNumber.eq(currentBlock), "Unexpected block number");
      assert(timestamp.lte(startTs.addn(86400 + 1)), "Timestamp not lte asked for");
    });

    it("Should add a second closing period when period rolls over", async() => {
      // Assemble
      // Pump keep to get internals primed for a roll
      await closeManager.keep();
      // Time travel two hours and one second to simulate some hours passing
      await time.increaseTo(startTs.addn(7201));
      await closeManager.keep();
      // Time travel to tomorrow
      await time.increaseTo(startTs.addn(86400));
      // This should trigger a close
      await closeManager.keep();
      // Time travel two hours and one second to simulate more hours passing
      await time.increaseTo(startTs.addn(86400 + 7201));
      await closeManager.keep();
      // Time travel to the next day
      await time.increaseTo(startTs.addn(86400 + 86400));
      // This should trigger another close
      await closeManager.keep();

      // Act
      const {0: blockNumber, 1: timestamp} = await closeManager.closingPeriods(1);
      
      // Assert
      const currentBlock = BN(await web3.eth.getBlockNumber());
      assert(blockNumber.eq(currentBlock), "Unexpected block number");
      assert(timestamp.lte(startTs.addn(86400 + 86400 + 1)), "Timestamp not lte asked for");
    });
  });
});
