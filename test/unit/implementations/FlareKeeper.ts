import { 
  FlareKeeperInstance, 
  InflationMockInstance, 
  MockContractInstance } from "../../../typechain-truffle";

const {expectRevert, expectEvent} = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;
const genesisGovernance = require('../../utils/constants').genesisGovernance;

const FlareKeeper = artifacts.require("FlareKeeper");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");
const InflationMock = artifacts.require("InflationMock");

const BN = web3.utils.toBN;

const ONLY_GOVERNANCE_MSG = "only governance";
const TOO_MANY_CONTRACTS_MSG = "too many";
const INFLATION_ZERO_MSG = "inflation zero";
const CANT_FIND_CONTRACT_MSG = "contract not found";
const REGISTRATIONUPDATED_EVENT = "RegistrationUpdated";
const MINTINGREQUESTED_EVENT = "MintingRequested";
const ERR_OUT_OF_BALANCE = "out of balance";

contract(`FlareKeeper.sol; ${getTestFile(__filename)}; FlareKeeper unit tests`, async accounts => {
    // contains a fresh contract for each test
    let flareKeeper: FlareKeeperInstance;
    let mockInflation: InflationMockInstance;
    let mockContractToKeep: MockContractInstance;

    beforeEach(async() => {
        flareKeeper = await FlareKeeper.new();
        await flareKeeper.initialiseFixedAddress();
        mockContractToKeep = await MockContract.new();
        mockInflation = await InflationMock.new();
    });

    describe("register", async() => {
        it("Should register a contract to keep", async() => {
            // Assemble
            // Act
            const tx = await flareKeeper.registerToKeep(mockContractToKeep.address, {from: genesisGovernance});
            // Assert
            const keptContract = await flareKeeper.keepContracts(0);
            assert.equal(keptContract, mockContractToKeep.address);
            expectEvent(tx, REGISTRATIONUPDATED_EVENT);
        });

        it("Should reject contract registration if not from governed", async() => {
            // Assemble
            // Act
            const registerPromise = flareKeeper.registerToKeep(mockContractToKeep.address, {from: accounts[2]});
            // Assert
            await expectRevert(registerPromise, ONLY_GOVERNANCE_MSG);
        });

        it("Should not register a dup contract", async() => {
            // Assemble
            await flareKeeper.registerToKeep(mockContractToKeep.address, {from: genesisGovernance});
            // Act
            const tx = await flareKeeper.registerToKeep(mockContractToKeep.address, {from: genesisGovernance});
            // Assert
            const promise = flareKeeper.keepContracts(1);
            await expectRevert.unspecified(promise);
            expectEvent.notEmitted(tx, REGISTRATIONUPDATED_EVENT);
        });

        it("Should not register more contracts than allowable", async() => {
            // Assemble
            const MAX = 10;
            for (let i = 0; i < MAX-1; i++ ) {
                const contract = await MockContract.new();
                await flareKeeper.registerToKeep(contract.address, {from: genesisGovernance});
            }
            // Act
            const registerPromise = flareKeeper.registerToKeep(mockContractToKeep.address, {from: genesisGovernance});
            // Assert
            await expectRevert(registerPromise, TOO_MANY_CONTRACTS_MSG);
        });
    });

    describe("events", async() => {
      it.skip("Should test events more thoroughly...", async() => {
      });
    });

    describe("unregister", async() => {
        it("Should unregister a kept contract", async() => {
            // Assemble
            await flareKeeper.registerToKeep(mockContractToKeep.address, {from: genesisGovernance});
            // Act
            const tx = await flareKeeper.unregisterToKeep(mockContractToKeep.address, {from: genesisGovernance});
            // Assert
            const promise = flareKeeper.keepContracts(0);
            await expectRevert.unspecified(promise);
            expectEvent(tx, REGISTRATIONUPDATED_EVENT);
        });

        it("Should not unregister a kept contract not found", async() => {
            // Assemble
            // Act
            const unregisterPromise = flareKeeper.unregisterToKeep(mockContractToKeep.address, {from: genesisGovernance});
            // Assert
            await expectRevert(unregisterPromise, CANT_FIND_CONTRACT_MSG);
        });

        it("Should reject contract unregistration if not from governed", async() => {
            // Assemble
            await flareKeeper.initialiseFixedAddress();
            // Act
            const unregisterPromise = flareKeeper.unregisterToKeep(mockContractToKeep.address, {from: accounts[2]});
            // Assert
            await expectRevert(unregisterPromise, ONLY_GOVERNANCE_MSG);
        });
    });

    describe("keep", async() => {
        it("Should keep a contract", async() => {
            // Assemble
            const keep = web3.utils.sha3("keep()")!.slice(0,10); // first 4 bytes is function selector
            await mockContractToKeep.givenMethodReturnBool(keep, true);
            await flareKeeper.registerToKeep(mockContractToKeep.address, {from: genesisGovernance});
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
          const mockKeptContract = await MockContract.new();
          const keep = web3.utils.sha3("keep()")!.slice(0,10);
          await mockKeptContract.givenMethodRevertWithMessage(keep, "I am broken");
          await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
          await flareKeeper.registerToKeep(mockKeptContract.address, {from: genesisGovernance});

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
          const mockKeptContract = await MockContract.new();
          const keep = web3.utils.sha3("keep()")!.slice(0,10);
          await mockKeptContract.givenMethodRevertWithMessage(keep, "I am broken");
          await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
          await flareKeeper.registerToKeep(mockKeptContract.address, {from: genesisGovernance});

          // Act
          await flareKeeper.trigger();

          // Assert
          const { 3: erroringContractArr } = await flareKeeper.showKeptErrors(0, 10);
          assert.equal(erroringContractArr.length, 1);
          assert.equal(mockKeptContract.address, erroringContractArr[0]);
    
          // Act2
          await flareKeeper.trigger();

          // Assert2 - see same lenght for error types
          const { 3: erroringContractArr2 } = await flareKeeper.showKeptErrors(0, 10);
          assert.equal(erroringContractArr2.length, 1);
        });

        it("Should create new entry for new error type, correct string and correct error numbers", async() => {
          // Assemble
          const mockKeptContract = await MockContract.new();
          const keep = web3.utils.sha3("keep()")!.slice(0,10);
          await mockKeptContract.givenMethodRevertWithMessage(keep, "I am broken");
          await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
          await flareKeeper.registerToKeep(mockKeptContract.address, {from: genesisGovernance});

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
          const mockKeptContract = await MockContract.new();
          const keep = web3.utils.sha3("keep()")!.slice(0,10);
          await mockKeptContract.givenMethodRevertWithMessage(keep, "I am broken");
          await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
          await flareKeeper.registerToKeep(mockKeptContract.address, {from: genesisGovernance});

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
          assert.equal(errorContractArr[0], mockKeptContract.address);
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
          assert.equal(errorContractArr2[0], mockKeptContract.address);
          assert.equal(totalKeptErrors2.toNumber(), 2);
        });

        it("Should show last kept error data for two strings", async() => {
          // Assemble
          const mockKeptContract = await MockContract.new();
          const mockKeptContract2 = await MockContract.new();
          const keep = web3.utils.sha3("keep()")!.slice(0,10);
          await mockKeptContract.givenMethodRevertWithMessage(keep, "I am broken");
          await mockKeptContract2.givenMethodRevertWithMessage(keep, "Me tooooo");
          await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
          await flareKeeper.registerToKeep(mockKeptContract.address, {from: genesisGovernance});
          await flareKeeper.registerToKeep(mockKeptContract2.address, {from: genesisGovernance});

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
            await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
            // Assert
            assert.equal(await flareKeeper.inflation(), mockInflation.address);
        });

        it("Should not set mint accounting if not from governance", async() => {
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
          await flareKeeper.trigger();
          // Assert
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
          await flareKeeper.trigger();
          // Assert
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

        it("Should have cap on excessive minting", async() => {
          // Assemble
          await flareKeeper.setInflation(mockInflation.address, {from: genesisGovernance});
          await mockInflation.setFlareKeeper(flareKeeper.address);
          // Act
          const requestPromise = mockInflation.requestMinting(web3.utils.toWei(BN(100000000)));
          // Assert
          await expectRevert.unspecified(requestPromise); // unspecified because it is raised within mock call
        });        
    });
});
