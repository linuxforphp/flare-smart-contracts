import { 
  FlareKeeperInstance,
  InflationInstance,
  InflationReceiverMockInstance,
  MockContractInstance } from "../../../typechain-truffle";

const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const Inflation = artifacts.require("Inflation");
const MockContract = artifacts.require("MockContract");
const SharingPercentageProviderMock = artifacts.require("SharingPercentageProviderMock");
const InflationReceiverMock = artifacts.require("InflationReceiverMock");
const FlareKeeper = artifacts.require("FlareKeeper");

const ERR_TOPUP_LOW = "topup low";
const ONLY_GOVERNANCE_MSG = "only governance";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ERR_IS_ZERO = "address is 0";

enum TopupType{ FACTOROFDAILYAUTHORIZED, ALLAUTHORIZED }

const BN = web3.utils.toBN;

contract(`Inflation.sol; ${getTestFile(__filename)}; Inflation unit tests`, async accounts => {
    // contains a fresh contract for each test
    let mockInflationPercentageProvider: MockContractInstance;
    let mockSupply: MockContractInstance;
    let mockInflationSharingPercentageProvider: MockContractInstance;
    let inflation: InflationInstance;
    let mockInflationReceiverInterface: InflationReceiverMockInstance;
    let mockFlareKeeper: MockContractInstance;
    let mockFlareKeeperInterface: FlareKeeperInstance;
    let startTs: BN;
    const supply = 1000000;
    const inflationBips = 1000;
    const inflationFactor = inflationBips / 10000;
    const inflationForAnnum = supply * inflationFactor;

    beforeEach(async() => {
        mockSupply = await MockContract.new();
        mockInflationPercentageProvider = await MockContract.new();
        mockInflationSharingPercentageProvider = await MockContract.new();
        mockInflationReceiverInterface = await InflationReceiverMock.new();
        mockFlareKeeper = await MockContract.new();
        mockFlareKeeperInterface = await FlareKeeper.new();

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
            mockInflationPercentageProvider.address,
            mockInflationSharingPercentageProvider.address,
            mockFlareKeeper.address,
            0
        );
        inflation.setSupply(mockSupply.address);
    });

    describe("init", async() => {
      it("Should sum recognized inflation", async() => {
          // Assemble
          // Act
          await inflation.keep();
          // Assert
          const recognizedInflation = await inflation.getTotalRecognizedInflationWei();
          assert.equal(recognizedInflation.toNumber(), inflationForAnnum);
      });

      it("Should initialize the annum", async() => {
        // Assemble
        // Assume blockchain start time is 1/1/2021 - not a leap year
        // Act
        await inflation.keep();
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
      });
    });

    describe("recognize", async() => {
      it("Should recognize new annum when year rolls over", async() => {
        // Assume blockchain start time is 1/1/2021 - not a leap year
        // 2022 is also not a leap year...
        // Assemble
        await inflation.keep();
        const nowTs = await time.latest() as BN;
        // A year passes...
        await time.increaseTo(nowTs.addn((365 * 86400)));
        // Act
        await inflation.keep();
        // Assert
        const recognizedInflation = await inflation.getTotalRecognizedInflationWei();
        // We should have twice the recognized inflation accumulated...
        assert.equal(recognizedInflation.toNumber(), inflationForAnnum * 2);
      });
    });

    describe("authorize", async() => {
      it("Should not authorize inflation if no sharing percentages", async() => {
        // Assemble
        // Act
        await inflation.keep();
        // Assert
        const authorizedInflation = await inflation.getTotalAuthorizedInflationWei();
        assert.equal(authorizedInflation.toNumber(), 0);
      });

      it("Should authorize inflation - first cycle, 1 sharing percentage", async() => {
        // Assemble
        // Set up one sharing percentage
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 10000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        await inflation.keep();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        const actualAuthorizedInflation = await inflation.getTotalAuthorizedInflationWei();
        assert.equal(actualAuthorizedInflation.toNumber(), expectedAuthorizedInflation);
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
        await inflation.keep();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        const actualAuthorizedInflation = await inflation.getTotalAuthorizedInflationWei();
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

      it("Should authorize inflation - second cycle, 2 sharing percentages", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        await inflation.keep();
        const nowTs = await time.latest() as BN;
        // A day passes...
        await time.increaseTo(nowTs.addn(86400));
        // Act
        await inflation.keep();
        // Assert
        const expectedAuthorizedInflationCycle1 = Math.floor(inflationForAnnum / 365);
        const expectedAuthorizedInflationCycle2 = Math.floor((inflationForAnnum - expectedAuthorizedInflationCycle1) / 364);
        const expectedAuthorizedInflation = expectedAuthorizedInflationCycle1 + expectedAuthorizedInflationCycle2;
        const actualAuthorizedInflation = await inflation.getTotalAuthorizedInflationWei();
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
        await inflation.keep();
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
        await inflation.keep();
        // Assert
        const topup = await inflation.getTotalInflationTopupRequestedWei();
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

      it("Should not allow topup configuration change if not from governance", async() => {
        // Assemble
        // Act
        const setPromise = inflation.setTopupConfiguration((await MockContract.new()).address, TopupType.ALLAUTHORIZED, 100, {from: accounts[2]});        
        // Require
        await expectRevert(setPromise, ONLY_GOVERNANCE_MSG);
      });

      it("Should request inflation to topup - first cycle, 2 sharing percentages, by factor type (default)", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Act
        await inflation.keep();
        // Assert
        const expectedAuthorizedInflation = Math.floor(inflationForAnnum / 365);
        // This should cap at one days authorization...not the factor
        const expectedTopupService1 = Math.floor(expectedAuthorizedInflation * 0.3);
        const expectedTopupService2 = expectedAuthorizedInflation - expectedTopupService1;
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check topup inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].inflationTopupRequestedWei, expectedTopupService1);
        // Check topup inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].inflationTopupRequestedWei, expectedTopupService2);
      });

      it("Should request inflation to topup - second cycle, 2 sharing percentages, by factor type (default)", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        await inflation.keep();
        const nowTs = await time.latest() as BN;
        // A day passes...
        await time.increaseTo(nowTs.addn(86400));
        // Act
        await inflation.keep();
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
        await inflation.keep();
        const nowTs = await time.latest() as BN;
        // A day passes...
        await time.increaseTo(nowTs.addn(86400));
        // Act
        await inflation.keep();
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
        await inflation.keep();
        // Assert
        const expectedRequestedInflation = Math.floor(inflationForAnnum / 365);
        const requestMinting = mockFlareKeeperInterface.contract.methods.requestMinting(expectedRequestedInflation).encodeABI();
        const invocationCount = await mockFlareKeeper.invocationCountForCalldata.call(requestMinting);
        assert.equal(invocationCount.toNumber(), 1);
      });

      it("Should receive top'ed up inflation - first cycle, 2 sharing percentages, by factor type (default)", async() => {
        // Assemble
        // Set up two sharing percentages
        const sharingPercentages = [];
        sharingPercentages[0] = {inflationReceiver: (await MockContract.new()).address, percentBips: 3000};
        sharingPercentages[1] = {inflationReceiver: (await MockContract.new()).address, percentBips: 7000};
        const sharingPercentageProviderMock = await SharingPercentageProviderMock.new(sharingPercentages);
        await inflation.setInflationSharingPercentageProvider(sharingPercentageProviderMock.address);
        // Prime topup request buckets
        await inflation.keep();
        const toMint = await inflation.getTotalInflationTopupRequestedWei();
        // Act
        await inflation.receiveMinting({ value: toMint});
        // Assert
        const expectedReceivedInflation = Math.floor(inflationForAnnum / 365);
        // This should cap at one days authorization...not the factor
        const expectedTopupService1 = Math.floor(expectedReceivedInflation * 0.3);
        const expectedTopupService2 = expectedReceivedInflation - expectedTopupService1;
        const { 
          4: rewardServicesState } = await inflation.getCurrentAnnum() as any;
        // Check topup inflation for first reward service
        assert.equal(rewardServicesState.rewardServices[0].inflationTopupReceivedWei, expectedTopupService1);
        // Check topup inflation for the second reward service
        assert.equal(rewardServicesState.rewardServices[1].inflationTopupReceivedWei, expectedTopupService2);
        
        // Running sum should be correct
        assert.equal(
          (await inflation.getTotalInflationTopupReceivedWei()).toNumber(), expectedTopupService1 + expectedTopupService2
        );
      });
    });

    describe("funding", async() => {

      it("Should not reward before start time", async() => {
        // Assemble
        // We must create non default inflation, since default has rewardEpoch at 0
        mockSupply = await MockContract.new();
        mockInflationPercentageProvider = await MockContract.new();
        mockInflationSharingPercentageProvider = await MockContract.new();
        mockFlareKeeper = await MockContract.new();

        const getInflatableBalance = web3.utils.sha3("getInflatableBalance()")!.slice(0,10); // first 4 bytes is function selector
        const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0,10);
        await mockSupply.givenMethodReturnUint(getInflatableBalance, supply);
        await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, inflationBips);
        
        await time.advanceBlock();
        const latest = await time.latest();

        inflation = await Inflation.new(
            accounts[0],
            mockInflationPercentageProvider.address,
            mockInflationSharingPercentageProvider.address,
            mockFlareKeeper.address,
            latest + 2 * 86400 // Set time sometime after now, but at least two days to trigger new inflation if not exiting preemptively
        );

        await inflation.setSupply(mockSupply.address);
       
        // Act
        await inflation.keep();
        // It should return directly and not change lastAuthorizationTs
        const lastTs = await inflation.lastAuthorizationTs();
        assert.equal(lastTs.toNumber(), 0);
      });

      it("Should fund top'ed up inflation - first cycle, 2 sharing percentages, by factor type (default)", async() => {
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
        await inflation.keep();
        const toMint = await inflation.getTotalInflationTopupRequestedWei();
        // Act
        await inflation.receiveMinting({ value: toMint});
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
        assert.equal(
          (await inflation.getTotalInflationTopupWithdrawnWei()).toNumber() , expectedTopupService0 + expectedTopupService1
        );
        // Check that target reward service contracts got the FLR they are due
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
        await inflation.keep();
        const toMint = await inflation.getTotalInflationTopupRequestedWei();
        // Act
        // Sneak in 1 more to simulate self-destructing
        await inflation.receiveMinting({ value: toMint.addn(1) });
        // ...and if it got here, then we balance.
        // Assert
        // Check self destruct bucket for good measure...
        const selfDestructProceeds = await inflation.totalSelfDestructReceivedWei();
        assert.equal(selfDestructProceeds.toNumber(), 1);
      });      
    });

    describe("helper methods", async() => {
      
      it("Should set inflationPercentageProvider", async()=> {
        // Assemble
        const newMockInflationPercentageProvider = await MockContract.new();
        
        // Act
        await inflation.setInflationPercentageProvider(newMockInflationPercentageProvider.address);
        
        // Assert
        assert.equal((await inflation.inflationPercentageProvider()), newMockInflationPercentageProvider.address);

      });

      it("Should reject inflation provider change if not from governed", async() => {
        // Assemble
        const newMockInflationPercentageProvider = await MockContract.new();
        
        // Act
        const changePromise = inflation.setInflationPercentageProvider(newMockInflationPercentageProvider.address, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ONLY_GOVERNANCE_MSG);
        assert.equal((await inflation.inflationPercentageProvider()), mockInflationPercentageProvider.address);
      });

      it("Should set new flare keeper", async()=> {
        // Assemble
        const newMockFlareKeeper = await MockContract.new();
        
        // Act
        await inflation.setFlareKeeper(newMockFlareKeeper.address);
        
        // Assert
        assert.equal((await inflation.flareKeeper()), newMockFlareKeeper.address);

      });

      it("Should reject flare keeper change if not from governed", async() => {
        // Assemble
        const newMockFlareKeeper = await MockContract.new();
        
        // Act
        const changePromise = inflation.setFlareKeeper(newMockFlareKeeper.address, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ONLY_GOVERNANCE_MSG);
        assert.equal((await inflation.flareKeeper()), mockFlareKeeper.address);
      });

      it("Should reject flare keeper with 0 address", async() => {
        // Assemble
        
        // Act
        const changePromise = inflation.setFlareKeeper(ZERO_ADDRESS, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ERR_IS_ZERO);
        assert.equal((await inflation.flareKeeper()), mockFlareKeeper.address);
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
        const changePromise = inflation.setSupply(ZERO_ADDRESS, {from: accounts[2]});
        
        // Assert
        await expectRevert(changePromise, ERR_IS_ZERO);
        assert.equal((await inflation.supply()), mockSupply.address);
      });
    });

});
