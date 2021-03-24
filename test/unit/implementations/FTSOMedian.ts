// import { artifacts, assert, contract, ethers, web3 } from "hardhat";
import { ethers } from "hardhat";
import path from "path";
import chai from "chai";
import { checkTestCase, normal, prettyPrintVoteInfo, prettyPrintEpochResult, priceToRandom, readTestData, resultsFromTestData, TestCase, TestExample, toEpochResult, randomizeExampleGenerator, updateWithRewardedVotesInfo } from "../../utils/FTSO-test-utils";
import { TestExampleLogger } from "../../utils/TestExampleLogger"
import { MockFtso, MockVPToken } from "../../../typechain";
import { BigNumber } from "ethers";
const { expect } = chai;

const fs = require('fs');

const { soliditySha3 } = require("web3-utils");
const testCasesPath = 'test/test-cases/FTSO-cases'

/**
 * Increases block time.
 * @param addSeconds 
 */
function increaseTime(addSeconds: number) {
    ethers.provider.send("evm_increaseTime", [addSeconds])
    ethers.provider.send("evm_mine", [])
}

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
    let flrToken: MockVPToken;
    let assetToken: MockVPToken;
    let ftso: MockFtso;

    testExamples.forEach(testExample => {
        it(`${ testExample.fileName }: ${ testExample.description }`, async function () {
            // init
            const signers = await ethers.getSigners();
            await increaseTime(1000);
            let logger = new TestExampleLogger(testExample);
            let epochs: number[] = [];
            let isRandomized = !!testExample.randomizedDataCount
            let len = isRandomized ? testExample.randomizedDataCount! : testExample.prices.length;
            let epochPeriod = Math.floor(len * 5);
            let revealPeriod = Math.floor(epochPeriod * 3);
            if (len == 0) {
                throw Error(`Bad example file ${ testExample.fileName }. Length 0.`);
            }
            if (isRandomized) {
                randomizeExampleGenerator(testExample)
            }

            if (signers.length < len) throw Error(`To few accounts/signers: ${ signers.length }. Required ${ len }.`);

            logger.log("DEPLOY");

            const flrTokenFactory = await ethers.getContractFactory(
                "MockVPToken",
                signers[0]
            );
            flrToken = (await flrTokenFactory.deploy(
                signers.slice(0, len).map(signer => signer.address), testExample.weightsFlr)) as MockVPToken;
            await flrToken.deployed();
            
            const assetTokenFactory = await ethers.getContractFactory(
                "MockVPToken",
                signers[0]
            );
            assetToken = (await assetTokenFactory.deploy(
                signers.slice(0, len).map(signer => signer.address), 
                testExample.weightsAsset)) as MockVPToken;
            await assetToken.deployed();

            const ftsoFactory = await ethers.getContractFactory(
                "MockFtso",
                signers[0]
            );
            ftso = (await ftsoFactory.deploy(
                flrToken.address, assetToken.address, signers[0].address,  // address _fFlr, address _fAsset,
                0, 1, // uint256 _minVotePower,  uint256 _startTimestamp
                epochPeriod, revealPeriod //uint256 _epochPeriod, uint256 _revealPeriod
            )) as MockFtso;
            await ftso.deployed();

            let uniqueEpochs: number[] = [];
            while (uniqueEpochs.length != 1) {
                epochs = [];
                logger.log(`SUBMIT PRICE ${len}`)
                // Submit price
                let promises = [];
                for (let i = 0; i < len; i++) {
                    let price = testExample.prices[i];
                    let random = priceToRandom(price);
                    // TODO: try to the use correct hash from ethers.utils.keccak256
                    // let hash = ethers.utils.keccak256(ethers.utils.solidityKeccak256([ "uint128", "uint256" ], [ price, random ]))
                    let hash = soliditySha3({ type: 'uint128', value: price }, random);                    
                    promises.push((await ftso.connect(signers[i]).submitPrice(hash)).wait(1));                    
                }
                (await Promise.all(promises)).forEach(res => {
                    epochs.push((res.events![0].args![0] as BigNumber).toNumber());
                })
                uniqueEpochs = [...(new Set(epochs))];
                if(uniqueEpochs.length > 1) {
                    uniqueEpochs = [];
                    logger.log("BROKEN -> RESTART SUBMIT (Test splitted to more than one epoch)")
                    await increaseTime(1000);                    
                }
            }

            const epoch = uniqueEpochs[0];
            
            logger.log("WAIT FOR NEXT EPOCH")
            // Wait for next epoch
            while (true) {
                let tmpEpoch = await ftso.getCurrentEpoch()
                if (tmpEpoch.toNumber() > epoch + 1) break;
                await increaseTime(Math.floor(Math.max(len / 10, 10)))
            }

            logger.log("REVEAL PRICE")
            // Reveal price
            let epochPromises = [];
            for (let i = 0; i < len; i++) {
                epochPromises.push(ftso.connect(signers[i]).revealPrice(epoch, testExample.prices[i], priceToRandom(testExample.prices[i])))
            }
            logger.log("Epoch Cases:" + epochPromises.length)
            await Promise.all(epochPromises);

            logger.log("PRINT DATA")
            // Print epoch submission prices
            let resVoteInfo = await ftso.getVoteInfo(epoch);
            testExample.weightRatio = (await ftso.getWeightRatio(epoch)).toNumber();
            prettyPrintVoteInfo(resVoteInfo, logger);

            // Finalize
            await increaseTime(3 * revealPeriod);
            let resFinalizePrice = await (await ftso.finalizePriceEpochWithResult(epoch)).wait(1);
            logger.log(`epoch finalization, ${ len }, gas used: ${ resFinalizePrice.gasUsed }`);
            let epochFinalizeResponse = resFinalizePrice.events![0].args;
            // console.log("LOGS:", epochFinalizeResponse);

            // Print results                
            let res = await ftso.getEpochResult(epoch);
            prettyPrintEpochResult(res, logger);
            let voterRes = toEpochResult(res);
            let testCase = {
                example: testExample,
                targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
                testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
            } as TestCase;
            expect(checkTestCase(testCase)).to.be.true
        });
    });
});

