// import { artifacts, assert, contract, ethers, web3 } from "hardhat";
import { ethers } from "hardhat";
import path from "path";
import chai from "chai";
import { checkTestCase, normal, prettyPrintVoteInfo, prettyPrintEpochResult, priceToRandom, readTestData, resultsFromTestData, TestCase, TestExample, toEpochResult, randomizeExampleGenerator } from "../../utils/FTSO-test-utils";
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

            logger.log("REVEAL PRICE")
            // Reveal price

            uniqueEpochs.sort();
            let epochReveals = new Map();
            let testExamples = new Map<number, TestExample>();
            uniqueEpochs.forEach(epoch => {
                epochReveals.set(epoch, []);
                testExamples.set(epoch, {
                    description: testExample.description,
                    randomizedPivot: testExample.randomizedPivot,
                    prices: [],
                    weightsFlr: [],
                    weightsAsset: [],
                    weightRatio: 0,
                    priceAverage: testExample.priceAverage,
                    priceSD: testExample.priceSD,
                    weightFlrAverage: testExample.weightFlrAverage,
                    weightFlrSD: testExample.weightFlrSD,
                    weightAssetAverage: testExample.weightAssetAverage,
                    weightAssetSD: testExample.weightAssetSD
                })
            })

            for (let i = 0; i < len; i++) {
                // account, epoch, price, random
                let price = testExample.prices[i]
                let weightFlr = testExample.weightsFlr[i];
                let weightAsset = testExample.weightsAsset[i];
                epochReveals.get(epochs[i])!.push([signers[i], epochs[i], price, priceToRandom(price)]);
                let ex = testExamples.get(epochs[i])!
                ex.prices.push(price);
                ex.weightsFlr.push(weightFlr);
                ex.weightsAsset.push(weightAsset);
            }

            for (let epoch of uniqueEpochs) {
                // Wait for next epoch
                while (true) {
                    let tmpEpoch = await ftso.getCurrentEpoch()
                    if (tmpEpoch.toNumber() > epoch + 1) break;
                    await increaseTime(Math.floor(Math.max(len / 10, 10)))
                }
                let epochPromises = [];
                for (let elt of epochReveals.get(epoch)!) {
                    epochPromises.push(ftso.connect(elt[0]).revealPrice(epoch, elt[2], elt[3]))
                }
                logger.log("Epoch Cases:" + epochPromises.length)
                await Promise.all(epochPromises);
            }

            logger.log("PRINT DATA")
            // Print epoch submission prices
            for (let epoch of uniqueEpochs) {
                let res = await ftso.getVoteInfo(epoch);
                testExample.weightRatio = (await ftso.getWeightRatio(epoch)).toNumber();
                prettyPrintVoteInfo(res, logger)
            }

            // Finalize
            await increaseTime(3 * revealPeriod);
            // let epochFinalizeResponses: any[] = [] 
            for (let epoch of uniqueEpochs) {
                let res = await (await ftso.finalizePriceEpochWithResult(epoch)).wait(1)                
                logger.log(`epoch finalization, ${ epochReveals.get(epoch)!.length }, gas used: ${ res.gasUsed }`);
                // epochFinalizeResponses.push(res.events![0].args)
                // TODO: do the test on this!!!
                // console.log("LOGS:", res.events![0].args);
            }

            // Print results                
            for (let epoch of uniqueEpochs) {
                let res = await ftso.getEpochResult(epoch);
                prettyPrintEpochResult(res, logger);
                let voterRes = toEpochResult(res);
                let testCase = {
                    example: testExamples.get(epoch),
                    targetResult: resultsFromTestData(testExamples.get(epoch)!),
                    testResult: voterRes
                } as TestCase;
                expect(checkTestCase(testCase)).to.be.true
            }
        });
    });
});

