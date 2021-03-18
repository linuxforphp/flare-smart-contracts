// For testing purposes during development - should be deleted at end.
// Run
// yarn ts-node scripts/test.ts
import { readTestData, resultsFromTestData } from "../test/utils/FTSO-test-utils";


async function test() {
    let fname = "small-4.json";
    let testExample = await readTestData(`../test-utils/FTSO-cases/${fname}`);
    console.log(testExample);
    console.log(resultsFromTestData(testExample))
}

test()
