import { 
  EndlessLoopMockInstance,
  FlareKeeperInstance, 
  InflationMockInstance, 
  MockContractInstance } from "../../../../typechain-truffle";

const {expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../../utils/constants').getTestFile;
const genesisGovernance = require('../../../utils/constants').genesisGovernance;

const FlareKeeper = artifacts.require("FlareKeeper");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");
const InflationMock = artifacts.require("InflationMock");
const EndlessLoopMock = artifacts.require("EndlessLoopMock");

const BN = web3.utils.toBN;

const ONLY_GOVERNANCE_MSG = "only governance";
const TOO_MANY_CONTRACTS_MSG = "too many";
const INFLATION_ZERO_MSG = "inflation zero";
const REGISTRATIONUPDATED_EVENT = "RegistrationUpdated";
const MINTINGREQUESTED_EVENT = "MintingRequested";
const MINTINGRECEIVED_EVENT = "MintingReceived";
const MINTINGWITHDRAWN_EVENT = "MintingWithdrawn";
const SELFDESTRUCTRECEIVED_EVENT = "SelfDestructReceived";
const CONTRACTHELDOFF_EVENT = "ContractHeldOff";
const CONTRACTKEPT_EVENT = "ContractKept";
const CONTRACTKEEPERRORED_EVENT = "ContractKeepErrored";
const INFLATIONSET_EVENT = "InflationSet";
const ERR_DUPLICATE_ADDRESS = "dup address";
const ERR_OUT_OF_GAS = "out of gas";


const MAX_MINTING_FREQUENCY_SEC = 23 * 60 * 60; // Limit from FlareKeeper

contract(`FlareKeeper.sol; ${getTestFile(__filename)}; FlareKeeper unit tests`, async accounts => {
  // contains a fresh contract for each test
  let flareKeeper: FlareKeeperInstance;
  let mockInflation: InflationMockInstance;
  let mockContractToKeep: MockContractInstance;
  let endlessLoop: EndlessLoopMockInstance;
  const keep = web3.utils.sha3("keep()")!.slice(0,10); // first 4 bytes is function selector

  beforeEach(async() => {
    flareKeeper = await FlareKeeper.new();
    await flareKeeper.initialiseFixedAddress();
    mockContractToKeep = await MockContract.new();
    mockInflation = await InflationMock.new();
    endlessLoop = await EndlessLoopMock.new();
  });

  describe("register", async() => {
    it("Should register a contract to keep", async() => {
      // Assemble
      const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
      // Act
      const tx = await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      // Assert
      const keptContract = await flareKeeper.keepContracts(0);
      assert.equal(keptContract, mockContractToKeep.address);
      expectEvent(tx, REGISTRATIONUPDATED_EVENT, {theContract: mockContractToKeep.address, add: true});
    });

    it("Should reject contract registration if not from governance", async() => {
      // Assemble
      const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
      // Act
      const registerPromise = flareKeeper.registerToKeep(registrations, {from: accounts[2]});
      // Assert
      await expectRevert(registerPromise, ONLY_GOVERNANCE_MSG);
    });

    it("Should not register a dup contract", async() => {
      // Assemble
      const registrations = [
        {keptContract: mockContractToKeep.address, gasLimit: 0},
        {keptContract: mockContractToKeep.address, gasLimit: 0}
      ];
      // Act
      const promise = flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      // Assert
      await expectRevert(promise, ERR_DUPLICATE_ADDRESS);
    });

    it("Should not register more contracts than allowed", async() => {
      // Assemble
      const MAX = 10;
      const registrations = [];
      for (let i = 0; i <= MAX; i++ ) {
        const registration = {keptContract: (await MockContract.new()).address, gasLimit: 0};
        registrations.push(registration);
      }
      // Act
      const registerPromise = flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      // Assert
      await expectRevert(registerPromise, TOO_MANY_CONTRACTS_MSG);
    });
  });

  describe("unregister", async() => {
      it("Should unregister a kept contract", async() => {
        // Assemble
        const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
        await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
        // Act
        const tx = await flareKeeper.unregisterAll({from: genesisGovernance});
        // Assert
        const promise = flareKeeper.keepContracts(0);
        await expectRevert.unspecified(promise);
        expectEvent(tx, REGISTRATIONUPDATED_EVENT, {theContract: mockContractToKeep.address, add: false});
      });

      it("Should reject contract unregistration if not from governed", async() => {
        // Assemble
        // Act
        const unregisterPromise = flareKeeper.unregisterAll({from: accounts[2]});
        // Assert
        await expectRevert(unregisterPromise, ONLY_GOVERNANCE_MSG);
      });

      it("Should register all", async() => {
        // Assemble
        const MAX = 10;
        const registrations = [];
        for (let i = 0; i < MAX; i++ ) {
          const registration = {keptContract: (await MockContract.new()).address, gasLimit: 0};
          registrations.push(registration);
        }
        await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
        const lastAddress = await flareKeeper.keepContracts(9);
        // Act
        await flareKeeper.unregisterAll({from: genesisGovernance});
        // Assert
        const promise = flareKeeper.keepContracts(0);
        await expectRevert.unspecified(promise);
      });  
  });

  describe("keep", async() => {
    it("Should keep a contract", async() => {
      // Assemble
      // Shim up mock
      await mockContractToKeep.givenMethodReturnBool(keep, true);
      // Register mock
      const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      // Act
      await flareKeeper.trigger();
      // Assert
      const invocationCount = await mockContractToKeep.invocationCountForMethod.call(keep);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should advance last triggered block", async() => {
      // Assemble
      const oldLastTriggeredBlock = await flareKeeper.systemLastTriggeredAt();
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      // Act
      await flareKeeper.trigger();
      // Assert
      const currentBlock = await web3.eth.getBlockNumber();            
      const lastTriggeredBlock = await flareKeeper.systemLastTriggeredAt();
      assert(lastTriggeredBlock.toNumber() > oldLastTriggeredBlock.toNumber());
      assert.equal(lastTriggeredBlock.toNumber(), currentBlock);
    });

    it.skip("Should revert if trigger called more than once from same block", async() => {
        // TODO: Test reject if trigger called more than once for same block; HH advances the block for every call.
        // Not sure how to do this in an automated manner.
        // 2.1.0 Version of Hardhat supports interval mining
        // https://github.com/nomiclabs/hardhat/releases/tag/hardhat-core-v2.1.0
    });

    it("Should return amount to mint when triggered with a pending mint request", async() => {
      // Assemble
      await flareKeeper.setInflation(accounts[0], {from: genesisGovernance});
      await flareKeeper.requestMinting(BN(100), { from: accounts[0] });
      // Act
      const toMint = await flareKeeper.trigger.call();
      // Assert
      assert.equal(toMint.toNumber(), 100);
    });

    it("Should emit event when triggered with a pending mint request", async() => {
      // Assemble
      await flareKeeper.setInflation(accounts[0], {from: genesisGovernance});
      await flareKeeper.requestMinting(BN(100), { from: accounts[0] });
      // Act
      const tx = await flareKeeper.trigger();
      // Assert
      await expectEvent(tx, MINTINGREQUESTED_EVENT, {amountWei: BN(100)});
    });

    it("Should log error if inflation not set", async() => {
      // Assemble
      // Act
      const tx = await flareKeeper.trigger();
      // Assert
      const { 2: errorStringArr} = await flareKeeper.showLastKeptError();
      assert.equal(errorStringArr[0], INFLATION_ZERO_MSG);
    });

    it("Should advance keep error counter if kept contract reverts", async() => {
      // Assemble
      await mockContractToKeep.givenMethodRevertWithMessage(keep, "I am broken");
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});

      // Act
      await flareKeeper.trigger();

      // Assert
      const {0: numKeptErrors} = await flareKeeper.errorData();
      assert.equal(numKeptErrors.toNumber(), 1);

      // Act
      await flareKeeper.trigger();

      // Assert
      const {0: numKeptErrors2} = await flareKeeper.errorData();
      assert.equal(numKeptErrors2.toNumber(), 2);
    });

    it("Should create new entry for new error type, correct contract address, not create new entry for repeating error type", async() => {
      // Assemble
      await mockContractToKeep.givenMethodRevertWithMessage(keep, "I am broken");
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});

      // Act
      await flareKeeper.trigger();

      // Assert
      const { 3: erroringContractArr } = await flareKeeper.showKeptErrors(0, 10);
      assert.equal(erroringContractArr.length, 1);
      assert.equal(mockContractToKeep.address, erroringContractArr[0]);

      // Act2
      await flareKeeper.trigger();

      // Assert2 - see same lenght for error types
      const { 3: erroringContractArr2 } = await flareKeeper.showKeptErrors(0, 10);
      assert.equal(erroringContractArr2.length, 1);
    });

    it("Should create new entry for new error type, correct string and correct error numbers", async() => {
      // Assemble
      await mockContractToKeep.givenMethodRevertWithMessage(keep, "I am broken");
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});

      // Act
      let tx = await flareKeeper.trigger();
      const { 
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr
        } = await flareKeeper.showKeptErrors(0, 10);

      // Assert
      assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");

      // Act
      tx = await flareKeeper.trigger();
      const { 
        0: lastErrorBlockArr2,
        1: numErrorsArr2,
        2: errorStringArr2
      } = await flareKeeper.showKeptErrors(0, 10);

      // Assert
      assert.equal(lastErrorBlockArr2[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr2[0].toNumber(), 2);
      assert.equal(errorStringArr2[0], "I am broken");
    });

    it("Should show last kept error data", async() => {
      // Assemble
      await mockContractToKeep.givenMethodRevertWithMessage(keep, "I am broken");
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      const registrations = [{keptContract: mockContractToKeep.address, gasLimit: 0}];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});

      // Act
      let tx = await flareKeeper.trigger();
      const { 
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr,
        3: errorContractArr,
        4: totalKeptErrors
        } = await flareKeeper.showLastKeptError();

      // Assert
      assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");
      assert.equal(errorContractArr[0], mockContractToKeep.address);
      assert.equal(totalKeptErrors.toNumber(), 1);

      // Act
      tx = await flareKeeper.trigger();
      const { 
        0: lastErrorBlockArr2,
        1: numErrorsArr2,
        2: errorStringArr2,
        3: errorContractArr2,
        4: totalKeptErrors2
      } = await flareKeeper.showLastKeptError();

      // Assert
      assert.equal(lastErrorBlockArr2[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr2[0].toNumber(), 2);
      assert.equal(errorStringArr2[0], "I am broken");
      assert.equal(errorContractArr2[0], mockContractToKeep.address);
      assert.equal(totalKeptErrors2.toNumber(), 2);
    });

    it("Should show last kept error data for two strings", async() => {
      // Assemble
      const mockKeptContract = await MockContract.new();
      const mockKeptContract2 = await MockContract.new();
      await mockKeptContract.givenMethodRevertWithMessage(keep, "I am broken");
      await mockKeptContract2.givenMethodRevertWithMessage(keep, "Me tooooo");
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      const registrations = [
        {keptContract: mockKeptContract.address, gasLimit: 0},
        {keptContract: mockKeptContract2.address, gasLimit: 0}
      ];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});

      // Act
      let tx = await flareKeeper.trigger();
      const { 
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr,
        3: errorContractArr,
        4: totalKeptErrors
        } = await flareKeeper.showKeptErrors(0, 2);

      // Assert
      assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");
      assert.equal(errorStringArr[1], "Me tooooo");
      assert.equal(errorContractArr[0], mockKeptContract.address);
      assert.equal(errorContractArr[1], mockKeptContract2.address);
      assert.equal(totalKeptErrors.toNumber(), 2);
    });
  });

  describe("governance", async() => {
    it("Should transfer governance", async() => {
      // Assemble
      await flareKeeper.proposeGovernance(accounts[1], {from: genesisGovernance});
      await flareKeeper.claimGovernance({from: accounts[1]});
      // Act
      let newGovernance = await flareKeeper.governance();
      // Assert
      assert.equal(newGovernance, accounts[1]);
    })
  });

  describe("minting", async() => {
    it("Should set inflation", async() => {
      // Assemble
      // Act
      const receipt = await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      // Assert
      assert.equal(await flareKeeper.inflation(), mockInflation.address);
      await expectEvent(receipt, INFLATIONSET_EVENT);
    });

    it("Should not set inflation if not from governance", async() => {
      // Assemble
      // Act
      const promise = flareKeeper.setInflation(mockInflation.address, {from: accounts[0]});
      // Assert
      await expectRevert(promise, "only governance");
    });

    it("Should request and transfer minted amount to inflation", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      await mockInflation.setDoNotReceiveNoMoreThan(1000);
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareKeeper.trigger();
      // Our fakey validator will be suiciding the right amount of FLR into flareKeeper
      const suicidalMock = await SuicidalMock.new(flareKeeper.address);
      // Give suicidal some FLR
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
      // Suicidal validator mints
      await suicidalMock.die();
      // Act
      let receipt = await flareKeeper.trigger();
      // Assert
      expectEvent(receipt, MINTINGRECEIVED_EVENT, {amountWei: "100"});
      expectEvent(receipt, MINTINGWITHDRAWN_EVENT, {amountWei: "100"});
      const inflationBalance = BN(await web3.eth.getBalance(mockInflation.address));
      assert.equal(inflationBalance.toNumber(), 100);
    })

    it("Should post received FLR to self-destruct bucket if minting not expected", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      // Request more that we are going to receive
      await mockInflation.requestMinting(110);
      // Our subversive attacker will be suiciding some FLR into flareKeeper
      const suicidalMock = await SuicidalMock.new(flareKeeper.address);
      // Give suicidal some FLR
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
      // Attacker dies
      await suicidalMock.die();
      // Act
      let receipt = await flareKeeper.trigger();
      // Assert
      expectEvent(receipt, SELFDESTRUCTRECEIVED_EVENT, {amountWei: "100"});
      const receivedSelfDestructProceeds = await flareKeeper.totalSelfDestructReceivedWei();
      assert(receivedSelfDestructProceeds.eq(BN(100)));
      const keeperBalance = BN(await web3.eth.getBalance(flareKeeper.address));
      assert(keeperBalance.eq(BN(100)));
    });

    it("Should receive scheduled minting and any received self-destructed balance", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      await mockInflation.setDoNotReceiveNoMoreThan(1000);
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareKeeper.trigger();
      // Our fakey validator will be suiciding the right amount of FLR into flareKeeper
      const suicidalMock = await SuicidalMock.new(flareKeeper.address);
      // Give suicidal some FLR
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 110});
      // Suicidal validator mints and we pretend that another attacker attacks in same block
      await suicidalMock.die();
      // Act
      await flareKeeper.trigger();
      // Assert
      // Target got expected balance
      const inflationBalance = BN(await web3.eth.getBalance(mockInflation.address));
      assert(inflationBalance.eq(BN(100)), "rewarding target did not get expected balance");
      // Keeper recorded self-destruct balance
      const receivedSelfDestructProceeds = await flareKeeper.totalSelfDestructReceivedWei();
      assert(receivedSelfDestructProceeds.eq(BN(10)), "expected self destruct balance incorrect");
      // Keeper still has remaining balance
      const keeperBalance = BN(await web3.eth.getBalance(flareKeeper.address));
      assert(keeperBalance.eq(BN(10)), "keeper does not contain expected balance");
    });

    // Working version
    it("Should self destruct when minting more than available", async () => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      await mockInflation.requestMinting(BN(100));

      await flareKeeper.trigger();
      // Our fakey validator will be suiciding with less than expected to mint
      const suicidalMock = await SuicidalMock.new(flareKeeper.address);
      // Give suicidal some FLR
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 90});
      // Suicidal validator mints and we pretend that another attacker attacks in same block
      await suicidalMock.die();
      // Act
      await flareKeeper.trigger();
      // Assert
      // Nothing was minted
      const inflationBalance = BN(await web3.eth.getBalance(mockInflation.address));
      assert(inflationBalance.eq(BN(0)), "rewarding target did not get expected balance");
      // Keeper recorded self-destruct balance
      const receivedSelfDestructProceeds = await flareKeeper.totalSelfDestructReceivedWei();
      assert(receivedSelfDestructProceeds.eq(BN(90)), "expected self destruct balance incorrect");
      // Keeper still has remaining balance
      const keeperBalance = BN(await web3.eth.getBalance(flareKeeper.address));
      assert(keeperBalance.eq(BN(90)), "keeper does not contain expected balance");
      
    });

    it("Should log error if transfer of requested minting fails", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      await mockInflation.setDoNotReceiveNoMoreThan(BN(90));
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareKeeper.trigger();
      // Our fakey validator will be suiciding the right amount of FLR into flareKeeper
      const suicidalMock = await SuicidalMock.new(flareKeeper.address);
      // Give suicidal some FLR
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
      // Suicidal validator mints
      await suicidalMock.die();
      // Act
      await flareKeeper.trigger();
      // Assert
      const { 2: errorStringArr} = await flareKeeper.showLastKeptError();
      assert.equal(errorStringArr[0], "too much");
    });

    it("Should log error if transfer of requested minting fails when additional self-destruct received", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      await mockInflation.setDoNotReceiveNoMoreThan(90);
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareKeeper.trigger();
      // Our fakey validator will be suiciding the right amount of FLR into flareKeeper
      const suicidalMock = await SuicidalMock.new(flareKeeper.address);
      // Give suicidal some FLR
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 110});
      // Suicidal validator mints and we pretend that another attacker attacks in same block
      await suicidalMock.die();
      // Act
      await flareKeeper.trigger();
      // Assert
      const { 2: errorStringArr} = await flareKeeper.showLastKeptError();
      assert.equal(errorStringArr[0], "too much");
    });

    it("Should not allow mint request before timelock expires", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      await mockInflation.requestMinting(BN(100));
      // Act
      const requestPromise = mockInflation.requestMinting(BN(100));
      // Assert
      await expectRevert.unspecified(requestPromise); // unspecified because it is raised within mock call
    });

    it("Should allow mint request exactly after timelock expires", async() => {
      // This test currently waits 23h on a real network so run it with caution
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      // Advance block to ensure that keeper has current time
      await time.advanceBlock();
      await mockInflation.requestMinting(BN(100));

      // Do time shift
      // Advance just enough
      await time.increase(MAX_MINTING_FREQUENCY_SEC);

      // request minting as promise
      const requestPromise = mockInflation.requestMinting(BN(100));
      // Assert
      // Forced promise should not fail
      await requestPromise;
    });

    it("Should have cap on excessive minting", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);
      // Act
      const requestPromise = mockInflation.requestMinting(web3.utils.toWei(BN(100000000)));
      // Assert
      await expectRevert.unspecified(requestPromise); // unspecified because it is raised within mock call
    });

    it("Should make sure setMaxMintRequest changes are time locked", async() => {
      // Assemble
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await mockInflation.setFlareKeeper(flareKeeper.address);

      // first request should succeed.
      // correct amount success
      flareKeeper.setMaxMintingRequest(BN(1000), { from: genesisGovernance });

      await expectRevert(flareKeeper.setMaxMintingRequest(BN(1000), 
        { from: genesisGovernance }),
        "time gap too short");
    });
  });

  describe("gas limit", async() => {
    it("Should set gas limit", async() => {
      // Assemble
      const registrations = [{keptContract: endlessLoop.address, gasLimit: 1000000}];
      // Act
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      // Assert
      const gasLimit = await flareKeeper.gasLimits(endlessLoop.address);
      assert.equal(gasLimit.toString(), "1000000");
    });

    it("Should not exceed gas limit of runaway contract", async() => {
      const registrations = [{keptContract: endlessLoop.address, gasLimit: 1000000}];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      // Act
      await flareKeeper.trigger();
      // Assert
      const { 
        2: errorStringArr,
        3: erroringContractArr } = await flareKeeper.showKeptErrors(0, 10);
      assert.equal(endlessLoop.address, erroringContractArr[0]);
      assert.equal(errorStringArr[0], ERR_OUT_OF_GAS);
    });

    it("Should execute 2nd contract when 1st contract exceeds gas limit", async() => {
      // Assemble
      await mockContractToKeep.givenMethodReturnBool(keep, true);
      const registrations = [
        {keptContract: endlessLoop.address, gasLimit: 1000000},
        {keptContract: mockContractToKeep.address, gasLimit: 0}
      ];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      // Act
      await flareKeeper.trigger();
      // Assert
      const invocationCount = await mockContractToKeep.invocationCountForMethod.call(keep);
      assert.equal(invocationCount.toNumber(), 1);
    });
  });

  describe("holdoff", async() => {
    it("Should set block holdoff on contract when gas limit exceeded", async() => {
      const registrations = [
        {keptContract: endlessLoop.address, gasLimit: 1000000}
      ];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      // Act
      await flareKeeper.trigger();
      // Assert
      const holdoffRemaining = await flareKeeper.blockHoldoffsRemaining(endlessLoop.address);
      const holdoff = await flareKeeper.blockHoldoff();
      assert.equal(holdoffRemaining.toString(), holdoff.toString());
    });

    it("Should execute 2nd contract twice when 1st contract heldoff", async() => {
      // Assemble
      await mockContractToKeep.givenMethodReturnBool(keep, true);
      const registrations = [
        {keptContract: endlessLoop.address, gasLimit: 1000000},
        {keptContract: mockContractToKeep.address, gasLimit: 0}
      ];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await flareKeeper.setBlockHoldoff(10, {from: genesisGovernance});
      // Act
      await flareKeeper.trigger();
      const receipt = await flareKeeper.trigger();
      // Assert
      const invocationCount = await mockContractToKeep.invocationCountForMethod.call(keep);
      assert.equal(invocationCount.toNumber(), 2);
      await expectEvent(receipt, CONTRACTHELDOFF_EVENT);
    });

    it("Should execute endless loop contract again after being heldoff", async() => {
      // Assemble
      await mockContractToKeep.givenMethodReturnBool(keep, true);
      const registrations = [
        {keptContract: endlessLoop.address, gasLimit: 1000000},
        {keptContract: mockContractToKeep.address, gasLimit: 0}
      ];
      await flareKeeper.registerToKeep(registrations, {from: genesisGovernance});
      await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
      await flareKeeper.setBlockHoldoff(1, {from: genesisGovernance});
      // Act
      await flareKeeper.trigger();
      await flareKeeper.trigger();  // Holdoff
      const receipt = await flareKeeper.trigger();
      // Assert
      await expectEvent(receipt, CONTRACTKEEPERRORED_EVENT, {theContract: endlessLoop.address});
      await expectEvent(receipt, CONTRACTKEPT_EVENT, {theContract: mockContractToKeep.address});
    });

    it("Should set holdoff", async() => {
      // Assemble
      // Act
      const receipt = await flareKeeper.setBlockHoldoff(5, {from: genesisGovernance});
      // Assert
      const holdoff = await flareKeeper.blockHoldoff();
      assert.equal(holdoff.toString(), "5");
    });

    it("Should not set holdoff if not from governance", async() => {
      // Assemble
      // Act
      const receipt = flareKeeper.setBlockHoldoff(5);
      // Assert
      await expectRevert(receipt, ONLY_GOVERNANCE_MSG);
    });
  });
});
