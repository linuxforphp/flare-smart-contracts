import { 
  FlareKeeperInstance, 
  MintAccountingInstance, 
  MockContractInstance } from "../../../typechain-truffle";

const {expectRevert, expectEvent} = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;
const genesisGovernance = require('../../utils/constants').genesisGovernance;

const FlareKeeper = artifacts.require("FlareKeeper");
const MockContract = artifacts.require("MockContract");
const MintAccounting = artifacts.require("MintAccounting");
const SuicidalMock = artifacts.require("SuicidalMock");

const BN = web3.utils.toBN;

const ONLY_GOVERNANCE_MSG = "only governance";
const TOO_MANY_CONTRACTS_MSG = "too many";
const CANT_FIND_CONTRACT_MSG = "contract not found";
const REGISTRATIONUPDATED_EVENT = "RegistrationUpdated";
const NOT_MINTER = "not minter";
const ERR_OUT_OF_BALANCE = "out of balance";

contract(`FlareKeeper.sol; ${getTestFile(__filename)}; FlareKeeper unit tests`, async accounts => {
    // contains a fresh contract for each test
    let flareKeeper: FlareKeeperInstance;
    let mockMintAccounting: MockContractInstance;
    let mockContractToKeep: MockContractInstance;
    let mintAccountingInterface: MintAccountingInstance;

    beforeEach(async() => {
        flareKeeper = await FlareKeeper.new();
        await flareKeeper.initialiseFixedAddress();
        mockContractToKeep = await MockContract.new();
        mockMintAccounting = await MockContract.new();
        mintAccountingInterface = await MintAccounting.new(accounts[0], await (await MockContract.new()).address);
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
            const MAX = (await flareKeeper.MAX_KEEP_CONTRACTS()).toNumber();
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
            await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
            // Act
            await flareKeeper.trigger();
            // Assert
            const invocationCount = await mockContractToKeep.invocationCountForMethod.call(keep);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should advance last triggered block", async() => {
            // Assemble
            const oldLastTriggeredBlock = await flareKeeper.systemLastTriggeredAt();
            await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
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
          const getMintingRequested = mintAccountingInterface.contract.methods.getMintingRequested().encodeABI();
          await mockMintAccounting.givenMethodReturnUint(getMintingRequested, 100);
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          // Act
          const toMint = await flareKeeper.trigger.call();
          // Assert
          assert.equal(toMint.toNumber(), 100);
        });

        it("Should emit event when triggered with a pending mint request", async() => {
          // Assemble
          const getMintingRequested = mintAccountingInterface.contract.methods.getMintingRequested().encodeABI();
          await mockMintAccounting.givenMethodReturnUint(getMintingRequested, 100);
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          // Act
          const tx = await flareKeeper.trigger();
          // Assert
          await expectEvent(tx, "MintingRequested", {toMintTWei: BN(100)});
        });

        it("Should not trigger if mint accounting not set", async() => {
          // Assemble
          // Act
          const tx = flareKeeper.trigger();
          // Assert
          await expectRevert(tx, "mint accounting zero");
        });
        
        it("Should record error if kept contract reverts", async() => {
          // Assemble
          const mockKeptContract = await MockContract.new();
          const keep = web3.utils.sha3("keep()")!.slice(0,10);          
          await mockKeptContract.givenMethodRevertWithMessage(keep, "I am broken");
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          await flareKeeper.registerToKeep(mockKeptContract.address, {from: genesisGovernance});
          // Act
          const tx = await flareKeeper.trigger();
          // Assert
          const { 0: addressInError, 1: errorMessage } = await flareKeeper.errorsByBlock(await web3.eth.getBlockNumber(), 0);
          assert.equal(addressInError, mockKeptContract.address);
          assert.equal(errorMessage, "I am broken");
          await expectEvent(tx, "ContractKeepErrored", {
            theContract:  mockKeptContract.address, 
            atBlock: BN(await web3.eth.getBlockNumber()), 
            theMessage: "I am broken"});
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
        it("Should set mint accounting", async() => {
            // Assemble
            // Act
            await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
            // Assert
            assert.equal(await flareKeeper.mintAccounting(), mockMintAccounting.address);
        });

        it("Should not set mint accounting if not from governance", async() => {
          // Assemble
          // Act
          const promise = flareKeeper.setMintAccounting(mockMintAccounting.address, {from: accounts[0]});
          // Assert
          await expectRevert(promise, "only governance");
        });

        it("Should transfer minted amount to receiver", async() => {
          // Assemble
          const getKeeperBalance = web3.utils.sha3("getKeeperBalance()")!.slice(0,10); // first 4 bytes is function selector
          await mockMintAccounting.givenMethodReturnUint(getKeeperBalance, 1000);
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          // give keeper some flr to transfer
          await web3.eth.sendTransaction({ from: accounts[0], to: flareKeeper.address, value: 1000 });
          // set access control
          await flareKeeper.grantRole(await flareKeeper.MINTER_ROLE(), accounts[0], {from: await flareKeeper.governance()});
          // Act
          const openingBalance = BN(await web3.eth.getBalance(accounts[1]));
          await mockMintAccounting.givenMethodReturnUint(getKeeperBalance, 900);
          await flareKeeper.transferTo(accounts[1], 100);
          const closingBalance = BN(await web3.eth.getBalance(accounts[1]));
          // Assert
          const transfered = closingBalance.sub(openingBalance);
          assert.equal(transfered.toNumber(), 100);
        })

        it("Should not transfer if not minter", async() => {
          // Assemble
          // Act
          const transferPromise = flareKeeper.transferTo(accounts[1], 100);
          // Assert
          await expectRevert(transferPromise, NOT_MINTER);
        })

        it("Should post received FLR to GL in self-destruct bucket if minting not expected", async() => {
          // Assemble
          const getKeeperBalance = web3.utils.sha3("getKeeperBalance()")!.slice(0,10); // first 4 bytes is function selector
          await mockMintAccounting.givenMethodReturnUint(getKeeperBalance, 1000);
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          // Act
          await web3.eth.sendTransaction({ from: accounts[0], to: flareKeeper.address, value: 1000 });
          // Assert
          const receiveSelfDestructProceeds = mintAccountingInterface.contract.methods.receiveSelfDestructProceeds(1000).encodeABI();
          const invocationCount = await mockMintAccounting.invocationCountForCalldata.call(receiveSelfDestructProceeds);
          assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should post an unscheduled increase in balance to self-destruct bucket in GL", async() => {
          // Assemble
          const getKeeperBalance = web3.utils.sha3("getKeeperBalance()")!.slice(0,10); // first 4 bytes is function selector
          await mockMintAccounting.givenMethodReturnUint(getKeeperBalance, 100);
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          // Get suicidal
          const suicidalMock = await SuicidalMock.new(flareKeeper.address);
          // Give suicidal some FLR
          await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
          // Act
          await suicidalMock.die();
          await flareKeeper.trigger();
          // Assert
          const receiveSelfDestructProceeds = mintAccountingInterface.contract.methods.receiveSelfDestructProceeds(100).encodeABI();
          const invocationCount = await mockMintAccounting.invocationCountForCalldata.call(receiveSelfDestructProceeds);
          assert.equal(invocationCount.toNumber(), 1);
          assert.equal(parseInt(await web3.eth.getBalance(flareKeeper.address)), 100);
        });

        it("Should post an error if out of balance", async() => {
          // Assemble
          const getKeeperBalance = web3.utils.sha3("getKeeperBalance()")!.slice(0,10); // first 4 bytes is function selector
          await mockMintAccounting.givenMethodReturnUint(getKeeperBalance, 0);
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          // Get suicidal
          const suicidalMock = await SuicidalMock.new(flareKeeper.address);
          // Give suicidal some FLR
          await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
          // Act
          await suicidalMock.die();
          await flareKeeper.trigger();
          // Assert
          assert.equal(parseInt(await web3.eth.getBalance(flareKeeper.address)), 100);
          const { 0: addressInError, 1: errorMessage } = await flareKeeper.errorsByBlock(await web3.eth.getBlockNumber(), 0);
          assert.equal(addressInError, flareKeeper.address);
          assert.equal(errorMessage, ERR_OUT_OF_BALANCE);
        });
   
        it("Should post to GL amount of scheduled minting received and any self-destructed balance received", async() => {
          // Assemble
          const getKeeperBalance = web3.utils.sha3("getKeeperBalance()")!.slice(0,10); // first 4 bytes is function selector
          await mockMintAccounting.givenMethodReturnUint(getKeeperBalance, 200);
          const getMintingRequested = mintAccountingInterface.contract.methods.getMintingRequested().encodeABI();
          await mockMintAccounting.givenMethodReturnUint(getMintingRequested, 100);
          await flareKeeper.setMintAccounting(mockMintAccounting.address, {from: genesisGovernance});
          // Get suicidal
          const suicidalMock = await SuicidalMock.new(flareKeeper.address);
          // Give suicidal some FLR
          await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 200});
          // Act - this will simulate both a suicide and the validator conjuring a balance simultaneously
          await flareKeeper.trigger();
          await suicidalMock.die();
          await flareKeeper.trigger();
          // Assert
          const receiveSelfDestructProceeds = mintAccountingInterface.contract.methods.receiveSelfDestructProceeds(100).encodeABI();
          let invocationCount = await mockMintAccounting.invocationCountForCalldata.call(receiveSelfDestructProceeds);
          assert.equal(invocationCount.toNumber(), 1);
          const receiveMinting = mintAccountingInterface.contract.methods.receiveMinting(100).encodeABI();
          invocationCount = await mockMintAccounting.invocationCountForCalldata.call(receiveMinting);
          assert.equal(invocationCount.toNumber(), 1);
          assert.equal(parseInt(await web3.eth.getBalance(flareKeeper.address)), 200);
        });        
    });
});