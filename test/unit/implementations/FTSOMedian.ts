import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import path from "path";
import { MockFtso } from "../../../typechain";
import { checkTestCase, readTestData, TestCase, testFTSOInitContracts, testFTSOMedian } from "../../utils/FTSO-test-utils";

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

describe("FTSO contract - unit test cases from files", () => {

    testExamples.forEach(testExample => {
        it(`${ testExample.fileName }: ${ testExample.description }`, async function () {
            const epochStartTimestamp: number = 1;
            const signers: SignerWithAddress[] = await ethers.getSigners();
            const ftso: MockFtso = await testFTSOInitContracts(epochStartTimestamp, signers, testExample);
            const testCase: TestCase = await testFTSOMedian(epochStartTimestamp, signers, ftso, testExample);

            // Test results
            checkTestCase(testCase);
        });
    });
});

