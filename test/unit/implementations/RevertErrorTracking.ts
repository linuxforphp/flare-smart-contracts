import { 
    RevertErrorTrackingInstance,
    FlareKeeperInstance, 
    InflationMockInstance, 
    MockContractInstance } from "../../../typechain-truffle";

  const {expectRevert} = require('@openzeppelin/test-helpers');

  const getTestFile = require('../../utils/constants').getTestFile;

  const RevertErrorTracking = artifacts.require("RevertErrorTracking");

  const INDEX_TOO_HIGH = "start index high";

  contract(`RevertErrorTracking.sol; ${getTestFile(__filename)}; Revert Error Tracking unit tests`, async accounts => {
    // contains a fresh contract for each test
  let revertErrorTracking: RevertErrorTrackingInstance;
  let flareKeeper: FlareKeeperInstance;
  let mockInflation: InflationMockInstance;
  let mockContractToRevert: MockContractInstance;

  beforeEach(async() => {
      revertErrorTracking = await RevertErrorTracking.new();
  });

    describe('unit tests', async() => {
        
        it("it should not show last error if error counter is empty", async() => {
            await expectRevert(revertErrorTracking.showRevertedErrors(0, 0),INDEX_TOO_HIGH);
        })

        it("should add error and verify contract address,revert message", async()=>{
            await revertErrorTracking.addRevertError(accounts[0],"error1")
            let {2: errorStringArr, 3: errorContractArr, 4: totalRevertedErrors} = await revertErrorTracking.showLastRevertedError();

            await assert.equal(errorStringArr[0],"error1")
            await assert.equal(errorContractArr[0],accounts[0])
            await assert.equal(totalRevertedErrors.toNumber(), 1);

            await revertErrorTracking.addRevertError(accounts[1],"error2")
            let {2: errorStringArr1, 3: errorContractArr1, 4: totalRevertedErrors1} = await revertErrorTracking.showLastRevertedError();

            await assert.equal(errorStringArr1[0],"error2")
            await assert.equal(errorContractArr1[0],accounts[1])
            await assert.equal(totalRevertedErrors1.toNumber(), 2);
        })

        it("Should create new entry for same error type but unique contract addresses",async()=>{
            await revertErrorTracking.addRevertError(accounts[0],"error1")
            let {
                1: numErrorsArr,
                2: errorStringArr,
                3: errorContractArr,
                4: totalRevertedErrors
               } = await revertErrorTracking.showRevertedErrors(0,1);

            await assert.equal(numErrorsArr[0].toNumber(), 1);
            await assert.equal(errorStringArr[0],"error1")
            await assert.equal(errorContractArr[0],accounts[0])
            await assert.equal(totalRevertedErrors.toNumber(), 1);
        
            await revertErrorTracking.addRevertError(accounts[1],"error1")
            let {
                1: numErrorsArr1,
                2: errorStringArr1,
                3: errorContractArr1,
                4: totalRevertedErrors1
               } = await revertErrorTracking.showRevertedErrors(0,2);

            await assert.equal(numErrorsArr1[1].toNumber(),numErrorsArr[0].toNumber());
            await assert.equal(errorStringArr1[1],errorStringArr[0],"error1")
            await assert.equal(errorContractArr1[1],accounts[1])
            await assert.equal(totalRevertedErrors1.toNumber(), totalRevertedErrors.toNumber()+1);
        })
        
        it("Should add to existing entry for same error type and same contract addresses",async()=>{
            await revertErrorTracking.addRevertError(accounts[0],"error1")
            let {
                1: numErrorsArr,
                2: errorStringArr,
                3: errorContractArr,
                4: totalRevertedErrors
               } = await revertErrorTracking.showRevertedErrors(0,1);
            await assert.equal(numErrorsArr[0].toNumber(), 1);
            await assert.equal(errorStringArr[0],"error1")
            await assert.equal(errorContractArr[0],accounts[0])
            await assert.equal(totalRevertedErrors.toNumber(), 1);
        
        
            await revertErrorTracking.addRevertError(accounts[1],"error2")
            let {
                1: numErrorsArr1,
                2: errorStringArr1,
                3: errorContractArr1,
                4: totalRevertedErrors1
               } = await revertErrorTracking.showRevertedErrors(0,2);

            await assert.equal(numErrorsArr1[1].toNumber(),1);
            await assert.equal(errorStringArr1[1],"error2")
            await assert.equal(errorContractArr1[1],accounts[1])
            await assert.equal(totalRevertedErrors1.toNumber(), totalRevertedErrors.toNumber()+1);
        
            await revertErrorTracking.addRevertError(accounts[0],"error1")
            let {
                1: numErrorsArr2,
                4: totalRevertedErrors2
               } = await revertErrorTracking.showRevertedErrors(0,3);       

            await assert.equal(numErrorsArr2[0].toNumber(), numErrorsArr[0].toNumber()+1);
            await assert.equal(totalRevertedErrors2.toNumber(), totalRevertedErrors.toNumber()+2);
        })
        
        it("Should show last reverted error data",async()=>{
            await revertErrorTracking.addRevertError(accounts[0],"error1")
            let {
                1: numErrorsArr,
                2: errorStringArr,
                3: errorContractArr,
                4: totalRevertedErrors
               } = await revertErrorTracking.showRevertedErrors(0,1);

            await assert.equal(numErrorsArr[0].toNumber(), 1);
            await assert.equal(errorStringArr[0],"error1")
            await assert.equal(errorContractArr[0],accounts[0])
            await assert.equal(totalRevertedErrors.toNumber(), 1);
        
            await revertErrorTracking.addRevertError(accounts[1],"error2")
            let {
                1: numErrorsArr1,
                2: errorStringArr1,
                3: errorContractArr1,
                4: totalRevertedErrors1
               } = await revertErrorTracking.showRevertedErrors(0,2);

            await assert.equal(numErrorsArr1[1].toNumber(),1);
            await assert.equal(errorStringArr1[1],"error2")
            await assert.equal(errorContractArr1[1],accounts[1])
            await assert.equal(totalRevertedErrors1.toNumber(), totalRevertedErrors.toNumber()+1);
        
            let {1: lastNumErrorsArr, 2: lastErrorStringArr, 3: lastErrorContractArr, 4: totalErrors} = await revertErrorTracking.showLastRevertedError();

            await assert.equal(lastNumErrorsArr[0].toNumber(),numErrorsArr1[1].toNumber());
            await assert.equal(lastErrorStringArr[0],errorStringArr1[1],"error2")
            await assert.equal(lastErrorContractArr[0],errorContractArr1[1],accounts[1])
            await assert.equal(totalErrors.toNumber(), totalRevertedErrors1.toNumber());
        })

        it("Should show last revert error data for two strings", async() => {
            await revertErrorTracking.addRevertError(accounts[0],"error1")
            await revertErrorTracking.addRevertError(accounts[1],"error2")
            let {
                1: numErrorsArr,
                2: errorStringArr,
                3: errorContractArr,
                4: totalRevertedErrors
               } = await revertErrorTracking.showRevertedErrors(0,2);               
            assert.equal(numErrorsArr[0].toNumber(), 1);
            assert.equal(errorStringArr[0], "error1");
            assert.equal(errorStringArr[1], "error2");
            assert.equal(errorContractArr[0], accounts[0]);
            assert.equal(errorContractArr[1], accounts[1]);
            assert.equal(totalRevertedErrors.toNumber(), 2);
        });

        it("Should revert if start index is out of range", async() => {
            await revertErrorTracking.addRevertError(accounts[0],"error1")
            let {
                2: errorStringArr,
                3: errorContractArr,
                4: totalRevertedErrors
               } = await revertErrorTracking.showRevertedErrors(0,1);
            await assert.equal(errorStringArr[0],"error1")
            await assert.equal(errorContractArr[0],accounts[0])
            await assert.equal(totalRevertedErrors.toNumber(), 1);
            await expectRevert(revertErrorTracking.showRevertedErrors(1, 0),INDEX_TOO_HIGH);
            await expectRevert(revertErrorTracking.showRevertedErrors(2, 0),INDEX_TOO_HIGH);
        })
    })
})
