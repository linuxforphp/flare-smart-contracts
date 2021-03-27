import chai from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import path from "path";
import { MockFtso, MockVPToken } from "../../../typechain";
import { checkTestCase, moveFromCurrentToNextEpochStart, moveToFinalizeStart, moveToRevealStart, newContract, prettyPrintEpochResult, prettyPrintVoteInfo, priceToRandom, randomizeExampleGenerator, readTestData, resultsFromTestData, TestCase, toEpochResult, updateWithRewardedVotesInfo } from "../../utils/FTSO-test-utils";
import { TestExampleLogger } from "../../utils/TestExampleLogger";
const { expect } = chai;

const fs = require('fs');

const { soliditySha3 } = require("web3-utils");
const testCasesPath = 'test/test-cases/FTSO-cases'
const epochStartTimestamp = 1;

// Importing test cases
// Note: this snippet cannot be defined in `before`- needs to exist even before `before`
let files: string[] = fs.readdirSync(testCasesPath)
files.sort();
let testExamples = files.map(fname => {
    let data = readTestData(path.join("../..", testCasesPath, fname));
    data.fileName = fname;
    return data;
})

describe("FTSO contract - test cases from files", () => {
    testExamples.forEach(testExample => {
        it(`${ testExample.fileName }: ${ testExample.description }`, async function () {

            // init, data preparation
            const signers = await ethers.getSigners();
            let logger = new TestExampleLogger(testExample);
            let epochs: number[] = [];
            let isRandomized = !!testExample.randomizedDataCount
            let len = isRandomized ? testExample.randomizedDataCount! : testExample.prices.length;
            let epochPeriod = Math.floor(len + 2);
            let revealPeriod = Math.floor(len + 2);
            if (len == 0) {
                throw Error(`Bad example file ${ testExample.fileName }. Length 0.`);
            }
            if (isRandomized) {
                randomizeExampleGenerator(testExample)
            }
            if (signers.length < len) throw Error(`To few accounts/signers: ${ signers.length }. Required ${ len }.`);

            // Contract deployment
            let flrToken = await newContract<MockVPToken>(ethers, "MockVPToken", signers[0],
                signers.slice(0, len).map(signer => signer.address), testExample.weightsFlr
            )
            let assetToken = await newContract<MockVPToken>(ethers, "MockVPToken", signers[0],
                signers.slice(0, len).map(signer => signer.address), testExample.weightsAsset
            )
            let ftso = await newContract<MockFtso>(ethers, "MockFtso", signers[0],
                flrToken.address, assetToken.address, signers[0].address,  // address _fFlr, address _fAsset,
                epochStartTimestamp, // uint256 _startTimestamp
                epochPeriod, revealPeriod //uint256 _epochPeriod, uint256 _revealPeriod
            )

            // Price hash submission
            let uniqueEpochs: number[] = [];
            await moveFromCurrentToNextEpochStart(ethers, epochStartTimestamp, epochPeriod);
            epochs = [];

            logger.log(`SUBMIT PRICE ${ len }`)

            let promises = [];
            for (let i = 0; i < len; i++) {
                let price = testExample.prices[i];
                let random = priceToRandom(price);
                // TODO: try to the use correct hash from ethers.utils.keccak256
                // let hash = ethers.utils.keccak256(ethers.utils.solidityKeccak256([ "uint128", "uint256" ], [ price, random ]))
                let hash = soliditySha3(price, random);
                promises.push((await ftso.connect(signers[i]).submitPrice(hash)).wait(1));
            }
            (await Promise.all(promises)).forEach(res => {
                epochs.push((res.events![0].args![1] as BigNumber).toNumber());
            })
            uniqueEpochs = [...(new Set(epochs))];
            expect(uniqueEpochs.length, `Too short epoch for the test. Increase epochPeriod ${ epochPeriod }.`).to.equal(1)

            // Reveal price
            const epoch = uniqueEpochs[0];
            await moveToRevealStart(ethers, epochStartTimestamp, epochPeriod, epoch);
            let epochPromises = [];
            for (let i = 0; i < len; i++) {
                epochPromises.push(ftso.connect(signers[i]).revealPrice(epoch, testExample.prices[i], priceToRandom(testExample.prices[i])))
            }

            await Promise.all(epochPromises);

            // Print epoch submission prices
            let resVoteInfo = await ftso.getVoteInfo(epoch);
            testExample.weightRatio = (await ftso.getWeightRatio(epoch)).toNumber();
            prettyPrintVoteInfo(resVoteInfo, logger);

            // Finalize
            moveToFinalizeStart(ethers, epochStartTimestamp, epochPeriod, revealPeriod, epoch);
            let resFinalizePrice = await (await ftso.finalizePriceEpochWithResult(epoch)).wait(1);
            logger.log(`epoch finalization, ${ len }, gas used: ${ resFinalizePrice.gasUsed }`);
            let epochFinalizeResponse = resFinalizePrice.events![1].args;

            // Print results                
            let res = await ftso.getEpochResult(epoch);
            prettyPrintEpochResult(res, logger);
            let voterRes = toEpochResult(res);
            let testCase = {
                example: testExample,
                targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
                testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
            } as TestCase;

            // Test results
            expect(checkTestCase(testCase)).to.be.true
        });
    });
});

