import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { MockFtso, VPTokenMock, WFLR } from "../../typechain";
import { checkTestCase, moveFromCurrentToNextEpochStart, moveToFinalizeStart, moveToRevealStart, prettyPrintEpochResult, prettyPrintVoteInfo, resultsFromTestData, revealPrice, submitPrice, TestCase, TestExample, testFTSOMedian2, toEpochResult, updateWithRewardedVotesInfo } from "../utils/FTSO-test-utils";
import { newContract } from "../utils/test-helpers";
import { TestExampleLogger } from "../utils/TestExampleLogger";

const { expectRevert } = require('@openzeppelin/test-helpers');

async function deployContracts(signer: SignerWithAddress, epochStartTimestamp: number, epochPeriod: number, revealPeriod: number): Promise<{ flrToken: WFLR; assetToken: VPTokenMock; ftso: MockFtso; }> {

    let flrToken: WFLR = await newContract<WFLR>("WFLR", signer);
    let assetToken: VPTokenMock = await newContract<VPTokenMock>("VPTokenMock", signer, "fAsset", "FASSET");
    let ftso: MockFtso = await newContract<MockFtso>("MockFtso", signer,
        flrToken.address, assetToken.address, signer.address,  // address _fFlr, address _fAsset,
        epochStartTimestamp, // uint256 _startTimestamp
        epochPeriod, revealPeriod //uint256 _epochPeriod, uint256 _revealPeriod
    )

    return {flrToken, assetToken, ftso};
}

describe("VPToken and FTSO contract - integration tests - wflr", () => {
    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 10 submitters. 
     * Scenario
     * 10 data providers (with directly minted FLR tokens)
     * Run one price epoch
     * Expected Result:
     * Price computed correctly from freshly minted FLR across data providers.
     */
    it(`10 submitters with FLR tokens`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {flrToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const flrs: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 7, 15, 8, 10, 6];

        for (let i = 0; i < flrs.length; i++) {
            await flrToken.connect(signers[i]).deposit({value: flrs[i]});
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsFlr: flrs, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};

        const testCase: TestCase = await testFTSOMedian2(epochStartTimestamp, epochPeriod, revealPeriod, signers, ftso, testExample);

        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 5 submitters. 
     * Scenario
     * 5 data providers (with delegated WFLR tokens from 10 signers)
     * Run one price epoch
     */
    it(`5 submitters with delegated WFLR tokens only`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {flrToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const flrWeights: number[] = [0, 0, 0, 0, 0, 20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6];

        const flrs: number[] = [0, 0, 0, 0, 0];
        for (let i = 0; i < flrWeights.length; i++) {
            await flrToken.connect(signers[i]).deposit({value: flrWeights[i]});
            flrs[i % 5] += flrWeights[i];
            if (i >= 5) {
                await flrToken.connect(signers[i]).delegate(signers[i % 5].address, 10000);
            }
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsFlr: flrs, weightsAsset: [0,0,0,0,0]};

        const testCase: TestCase = await testFTSOMedian2(epochStartTimestamp, epochPeriod, revealPeriod, signers, ftso, testExample);

        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 5 submitters. 
     * Scenario
     * 5 data providers (with own and delegated WFLR tokens from 10 signers)
     * Run one price epoch
     */
    it(`5 submitters with own and delegated WFLR tokens`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {flrToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const flrWeights: number[] = [5e5, 15e5, 6e5, 9e5, 7e5, 20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6];

        const flrs: number[] = [0, 0, 0, 0, 0];
        for (let i = 0; i < flrWeights.length; i++) {
            await flrToken.connect(signers[i]).deposit({value: flrWeights[i]});
            flrs[i % 5] += flrWeights[i];
            if (i >= 5) {
                await flrToken.connect(signers[i]).delegateExplicit(signers[i % 5].address, flrWeights[i]);
            }
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsFlr: flrs, weightsAsset: [0,0,0,0,0]};

        const testCase: TestCase = await testFTSOMedian2(epochStartTimestamp, epochPeriod, revealPeriod, signers, ftso, testExample);

        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 5 submitters, but only 5 reveals. 
     * Scenario
     * 10 data providers (with wflr tokens)
     * Run one price epoch
     */
    it(`10 submitters - only 5 reveals `, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {flrToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const flrWeights: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 1, 2, 3, 4, 5];

        for (let i = 0; i < flrWeights.length; i++) {
            await flrToken.connect(signers[i]).deposit({value: flrWeights[i]});
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices.slice(0, 5), weightsFlr: flrWeights.slice(0, 5), weightsAsset: [0,0,0,0,0]};


        let logger = new TestExampleLogger(testExample);
        let len = testExample.prices.length;
        
        logger.log(`SUBMIT PRICE 10`)
        await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
        const { epoch } = await submitPrice(signers, ftso, prices);

        await ftso.initializeCurrentEpochStateForReveal();

        logger.log(`REVEAL PRICE 5`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
        await revealPrice(signers, ftso, prices.slice(0, 5), epoch);

        // Print epoch submission prices
        let resVoteInfo = await ftso.getVoteInfo(epoch);
        testExample.weightRatio = (await ftso.getWeightRatio(epoch)).toNumber();
        prettyPrintVoteInfo(resVoteInfo, testExample.weightRatio!, logger);

        // Finalize
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
        let resFinalizePrice = await (await ftso.finalizePriceEpochWithResult(epoch)).wait(1);
        logger.log(`epoch finalization, ${ len }, gas used: ${ resFinalizePrice.gasUsed }`);
        let epochFinalizeResponse = resFinalizePrice.events![1].args;
        
        // Print results                
        let res = await ftso.getEpochResult(epoch);
        prettyPrintEpochResult(res, testExample.weightRatio!, logger);
        let voterRes = toEpochResult(res);
        let testCase = {
            example: testExample,
            targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
        } as TestCase;
    
        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 10 submitters. 
     * Scenario
     * 10 data providers (with wflr tokens - equal all the time)
     * Run two price epoch
     */
    it(`10 submitters - 2 rounds of submit and reveal with equal weights`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 50;
        const revealPeriod = 25;

        let {flrToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const flrWeights: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 1, 2, 3, 4, 5];
        const prices2: number[] = [6, 10, 8, 5, 9, 5, 4, 3, 6, 5];

        for (let i = 0; i < flrWeights.length; i++) {
            await flrToken.connect(signers[i]).deposit({value: flrWeights[i]});
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsFlr: flrWeights, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};
        let testExample2: TestExample = {prices: prices2, weightsFlr: flrWeights, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};

        let logger = new TestExampleLogger(testExample);
        let len = testExample.prices.length;
        
        logger.log(`SUBMIT PRICE 1 - 10`)
        await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
        const { epoch } = await submitPrice(signers, ftso, testExample.prices);

        await ftso.initializeCurrentEpochStateForReveal();

        logger.log(`REVEAL PRICE 1 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
        await revealPrice(signers, ftso, testExample.prices, epoch);

        // Print epoch submission prices
        let resVoteInfo = await ftso.getVoteInfo(epoch);
        testExample.weightRatio = (await ftso.getWeightRatio(epoch)).toNumber();
        prettyPrintVoteInfo(resVoteInfo, testExample.weightRatio!, logger);

        logger.log(`SUBMIT PRICE 2 - 10`)
        await submitPrice(signers, ftso, testExample2.prices);

        // Finalize
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
        let resFinalizePrice = await (await ftso.finalizePriceEpochWithResult(epoch)).wait(1);
        logger.log(`epoch finalization 1, ${ len }, gas used: ${ resFinalizePrice.gasUsed }`);
        let epochFinalizeResponse = resFinalizePrice.events![1].args;
        
        // Print results                
        let res = await ftso.getEpochResult(epoch);
        prettyPrintEpochResult(res, testExample.weightRatio!, logger);
        let voterRes = toEpochResult(res);
        let testCase = {
            example: testExample,
            targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
        } as TestCase;
    
        // Test results
        checkTestCase(testCase);

        await ftso.initializeCurrentEpochStateForReveal();

        logger.log(`REVEAL PRICE 2 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch+1);
        await revealPrice(signers, ftso, testExample2.prices, epoch+1);

        // Print epoch submission prices
        let resVoteInfo2 = await ftso.getVoteInfo(epoch+1);
        testExample2.weightRatio = (await ftso.getWeightRatio(epoch+1)).toNumber();
        prettyPrintVoteInfo(resVoteInfo2, testExample2.weightRatio!, logger);

        // Finalize 2
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch+1);
        let resFinalizePrice2 = await (await ftso.finalizePriceEpochWithResult(epoch+1)).wait(1);
        logger.log(`epoch finalization 2, ${ len }, gas used: ${ resFinalizePrice2.gasUsed }`);
        let epochFinalizeResponse2 = resFinalizePrice2.events![1].args;
        
        // Print results 2
        let res2 = await ftso.getEpochResult(epoch+1);
        prettyPrintEpochResult(res2, testExample2.weightRatio!, logger);
        let voterRes2 = toEpochResult(res2);
        let testCase2 = {
            example: testExample2,
            targetResult: resultsFromTestData(testExample2, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes2, epochFinalizeResponse2)
        } as TestCase;
    
        // Test results 2
        checkTestCase(testCase2);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 10 submitters. 
     * Scenario
     * 10 data providers (with wflr tokens - different vote power)
     * Run two price epoch
     */
    it(`10 submitters - 2 rounds of submit and reveal with different weights - update votePowerBlock`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 70;
        const revealPeriod = 35;

        let {flrToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const flrWeights: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 1, 2, 3, 4, 5];
        
        for (let i = 0; i < flrWeights.length; i++) {
            await flrToken.connect(signers[i]).deposit({value: flrWeights[i]});
        }
        
        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsFlr: flrWeights, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};
        
        let logger = new TestExampleLogger(testExample);
        let len = testExample.prices.length;
        
        logger.log(`SUBMIT PRICE 1 - 10`)
        await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
        const { epoch } = await submitPrice(signers, ftso, testExample.prices);
        
        await ftso.initializeCurrentEpochStateForReveal();

        logger.log(`REVEAL PRICE 1 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
        await revealPrice(signers, ftso, testExample.prices, epoch);

        const flrWeights2: number[] = [50e5, 5e5, 18e5, 12e5, 25e5, 3e5, 8e5, 12e5, 5e5, 16e5];
        for (let i = 0; i < flrWeights2.length; i++) {
            if (flrWeights[i] > flrWeights2[i]) {
                await flrToken.connect(signers[i]).withdraw(flrWeights[i]-flrWeights2[i]);
            } else if (flrWeights[i] < flrWeights2[i]) {
                await flrToken.connect(signers[i]).deposit({value: flrWeights2[i] - flrWeights[i]});
            }
        }
        
        let blockNumber2 = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber2);
        
        const prices2: number[] = [6, 10, 8, 5, 9, 5, 4, 3, 6, 5];
        let testExample2: TestExample = {prices: prices2, weightsFlr: flrWeights2, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};
        // Print epoch submission prices
        let resVoteInfo = await ftso.getVoteInfo(epoch);
        testExample.weightRatio = (await ftso.getWeightRatio(epoch)).toNumber();
        prettyPrintVoteInfo(resVoteInfo, testExample.weightRatio!, logger);

        logger.log(`SUBMIT PRICE 2 - 10`)
        await submitPrice(signers, ftso, testExample2.prices);

        // Finalize
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
        let resFinalizePrice = await (await ftso.finalizePriceEpochWithResult(epoch)).wait(1);
        logger.log(`epoch finalization 1, ${ len }, gas used: ${ resFinalizePrice.gasUsed }`);
        let epochFinalizeResponse = resFinalizePrice.events![1].args;
        
        // Print results                
        let res = await ftso.getEpochResult(epoch);
        prettyPrintEpochResult(res, testExample.weightRatio!, logger);
        let voterRes = toEpochResult(res);
        let testCase = {
            example: testExample,
            targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
        } as TestCase;
    
        // Test results
        checkTestCase(testCase);

        await ftso.initializeCurrentEpochStateForReveal();

        logger.log(`REVEAL PRICE 2 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch+1);
        await revealPrice(signers, ftso, testExample2.prices, epoch+1);

        // Print epoch submission prices
        let resVoteInfo2 = await ftso.getVoteInfo(epoch+1);
        testExample2.weightRatio = (await ftso.getWeightRatio(epoch+1)).toNumber();
        prettyPrintVoteInfo(resVoteInfo2, testExample2.weightRatio!, logger);

        // Finalize 2
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch+1);
        let resFinalizePrice2 = await (await ftso.finalizePriceEpochWithResult(epoch+1)).wait(1);
        logger.log(`epoch finalization 2, ${ len }, gas used: ${ resFinalizePrice2.gasUsed }`);
        let epochFinalizeResponse2 = resFinalizePrice2.events![1].args;
        
        // Print results 2
        let res2 = await ftso.getEpochResult(epoch+1);
        prettyPrintEpochResult(res2, testExample2.weightRatio!, logger);
        let voterRes2 = toEpochResult(res2);
        let testCase2 = {
            example: testExample2,
            targetResult: resultsFromTestData(testExample2, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes2, epochFinalizeResponse2)
        } as TestCase;
    
        // Test results 2
        checkTestCase(testCase2);
    });

    /**
     * Purpose
     * FTSO finalize will revert if 0 submitters and minVoteCount > 0
     */
    it(`0 submitters - finalize should revert`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {flrToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);
        await ftso.configureEpochs(1, 1e10, 1e10, 1, 1, 1000, 10000, 50);
        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        
        await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
        let blockInfo = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
        const epoch = Math.floor((blockInfo.timestamp - epochStartTimestamp) / epochPeriod);

        // Finalize
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
        await expectRevert(ftso.finalizePriceEpoch(epoch, false), "Epoch has insufficient number of votes");
    });
});

