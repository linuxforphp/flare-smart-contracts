import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import path from "path";
import { MockFtso, VPTokenMock, WFLR } from "../../../typechain";
import { checkTestCase, randomizeExampleGenerator, readTestData, TestCase, testFTSOMedian2 } from "../../utils/FTSO-test-utils";
import { newContract } from "../../utils/test-helpers";

const fs = require('fs');

const testCasesPath = 'test/test-cases/FTSO-cases/unit'

// Importing test cases
// Note: this snippet cannot be defined in `before`- needs to exist even before `before`
let files: string[] = fs.readdirSync(testCasesPath)
files.sort();
let testExamples = files.map(fname => {
    let data = readTestData(path.join("../..", testCasesPath, fname));
    data.fileName = fname;
    return data;
})

describe("VPToken and FTSO contract - integration test cases from files", () => {
    testExamples.forEach(testExample => {
        it(`${ testExample.fileName }: ${ testExample.description }`, async function () {
            const epochStartTimestamp: number = 1;
            const signers: SignerWithAddress[] = await ethers.getSigners();

            // init, data preparation
            let isRandomized = !!testExample.randomizedDataCount
            let len = isRandomized ? testExample.randomizedDataCount! : testExample.prices.length;
            let epochPeriod = len + 3;
            let revealPeriod = len + 3;
            if (len == 0) {
                throw Error(`Bad example file ${ testExample.fileName }. Length 0.`);
            }
            if (isRandomized) {
                randomizeExampleGenerator(testExample)
            }
            if (signers.length < len) throw Error(`To few accounts/signers: ${ signers.length }. Required ${ len }.`);

            // Contract deployment
            let flrToken: WFLR = await newContract<WFLR>("WFLR", signers[0]);
            for (let i = 0; i < testExample.weightsFlr.length; i++) {
                await flrToken.connect(signers[i]).depositTo(signers[i].address, {value: testExample.weightsFlr[i]})
            }

            let assetToken = await newContract<VPTokenMock>("VPTokenMock", signers[0], "fAsset", "FASSET");
            for (let i = 0; i < testExample.weightsAsset.length; i++) {
                await assetToken.mint(signers[i].address, testExample.weightsAsset[i])
            }

            let blockNumber = await ethers.provider.getBlockNumber();

            let ftso: MockFtso = await newContract<MockFtso>("MockFtso", signers[0],
                flrToken.address, assetToken.address, signers[0].address,  // address _fFlr, address _fAsset,
                epochStartTimestamp, // uint256 _startTimestamp
                epochPeriod, revealPeriod //uint256 _epochPeriod, uint256 _revealPeriod
            )

            await ftso.setVotePowerBlock(blockNumber);
            const testCase: TestCase = await testFTSOMedian2(epochStartTimestamp, epochPeriod, revealPeriod, signers, ftso, testExample);

            // Test results
            checkTestCase(testCase);
        });
    });
});

