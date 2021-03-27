/**
 * Contains misc functions for testing FTSO oracle results.
 */

import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { BigNumber, ethers, Signer } from "ethers";

const { exec } = require("child_process");

////////////////////////////////////////////////////////////
//// INTERFACES
////////////////////////////////////////////////////////////

/**
 * Auxiliary interface for JSON returned by FTSO mock function `getVoteInfo`
 */
export interface VoteListRaw {
    epochId: BigNumber;
    prices: BigNumber[];
    weightsFlr: BigNumber[];
    weightsAsset: BigNumber[];
}

/**
 * Stores information about a price vote.
 */
export interface VoteInfo {
    id: number;
    price: number;
    weightFlr: number;
    weightAsset: number;
    runningSumFlr?: number;
    runningSumAsset?: number;
    runningPct?: number;
    weight?: number;
    address?: string;
}

export interface VoteList {
    epoch: number;
    votes: VoteInfo[];
}

/**
 * Auxiliary interface for JSON returned by FTSO mock function `getEpochResult`
 */
// interface EpochResultRaw {
//     epoch: number;
//     votes: [number, number, number, number][];
//     medians: [number, number, number, number, number];
//     prices: [number, number, number];
//     weights: [number, number, number, number, number, number]
// }

interface EpochResultRaw {
    epochId: BigNumber;
    votePrices: BigNumber[];
    weightsFlr: BigNumber[];
    weightsAsset: BigNumber[];
    medians: number[];
    prices: BigNumber[];
    weights: BigNumber[]
}

/**
 * Stores indices of position of a median and positions relevant to (truncated) weighted median.
 */
export interface MediansInfo {
    truncatedFirstQuartileIndex: number;
    firstQuartileIndex: number;
    medianIndex: number;
    lastQuartileIndex: number;
    truncatedLastQuartileIndex: number;
}

/**
 * Weight sums for epoch result.
 */
export interface WeightSumInfo {
    lowWeightSum: number;
    rewardedWeightSum: number;
    highWeightSum: number;
    FLRlowWeightSum: number;
    FLRrewardedWeightSum: number;
    FLRhighWeightSum: number;
}

/**
 * Price info for epoch result.
 */
export interface PriceInfo {
    lowRewardedPrice: number;
    medianPrice: number;
    highRewardedPrice: number;
}

/**
 * Result of the `findMedian` algorithm for a specific epoch.
 */
export interface EpochResult {
    epoch: number;
    votes: VoteInfo[];
    medians: MediansInfo;
    prices: PriceInfo;
    weights: WeightSumInfo;
    rewardedVotes?: RewardedVoteInfo[];
}

export interface RewardedVoteInfo {
    weightFlr: number;
    address: string;
}

/**
 * Description of a test example
 */
export interface TestExample {
    fileName?: string;
    description: string;
    randomizedPivot: boolean;
    /**
     * if this is > 0, then weightsFlr and weightsAsset should be empty [], and this number of pricess/weights is 
     * generated acording to *Averate and *SD parameters, which should be provided 
     */
    randomizedDataCount?: number;
    prices: number[];
    weightsFlr: number[];
    weightsAsset: number[];
    weightRatio: number,
    priceAverage?: number;
    priceSD?: number;
    weightFlrAverage?: number;
    weightFlrSD?: number;
    weightAssetAverage?: number;
    weightAssetSD?: number;
}

export interface TestCase {
    example: TestExample,
    targetResult: EpochResult,
    testResult?: EpochResult
}

////////////////////////////////////////////////////////////
//// CONVERSION FUNCTIONS
////////////////////////////////////////////////////////////

/**
 * Conversion function from `VoteListRaw` to `VoteList`.
 * @param voteList 
 * @returns 
 */
export function toVoteList(voteList: VoteListRaw): VoteList {

    let votes: VoteInfo[] = [];
    for (let i = 0; i < voteList.prices.length; i++) {
        votes.push({
            id: i,
            price: voteList.prices[i].toNumber(),
            weightFlr: voteList.weightsFlr[i].toNumber(),
            weightAsset: voteList.weightsAsset[i].toNumber(),
        });
    }

    return {
        epoch: voteList.epochId.toNumber(),
        votes
    }
}

/**
 * Conversion function from interface `EpochResultRaw` to `EpochResult`. 
 * @param epochResultRaw 
 * @returns 
 */
export function toEpochResult(epochResultRaw: EpochResultRaw): EpochResult {
    let votes: VoteInfo[] = [];
    for (let i = 0; i < epochResultRaw.votePrices.length; i++) {
        votes.push({
            id: i,
            price: epochResultRaw.votePrices[i].toNumber(),
            weightFlr: epochResultRaw.weightsFlr[i].toNumber(),
            weightAsset: epochResultRaw.weightsAsset[i].toNumber(),
        });
    }

    let totalFlrSum = 0;
    let totalAssetSum = 0;
    votes.forEach(vote => {
        totalFlrSum += vote.weightFlr;
        totalAssetSum += vote.weightAsset;
        vote.runningSumFlr = totalFlrSum;
        vote.runningSumAsset = totalAssetSum;
    })
    votes.forEach(vote => {
        vote.runningPct = ((vote.runningSumFlr! || 0) + (vote.runningSumAsset! || 0)) / (totalFlrSum + totalAssetSum);
    })

    return {
        epoch: epochResultRaw.epochId.toNumber(),
        votes: votes,
        medians: {
            truncatedFirstQuartileIndex: epochResultRaw.medians[0],
            firstQuartileIndex: epochResultRaw.medians[1],
            medianIndex: epochResultRaw.medians[2],
            lastQuartileIndex: epochResultRaw.medians[3],
            truncatedLastQuartileIndex: epochResultRaw.medians[4]
        },
        prices: {
            lowRewardedPrice: epochResultRaw.prices[0].toNumber(),
            medianPrice: epochResultRaw.prices[1].toNumber(),
            highRewardedPrice: epochResultRaw.prices[2].toNumber()
        },
        weights: {
            lowWeightSum: epochResultRaw.weights[0].toNumber(),
            rewardedWeightSum: epochResultRaw.weights[1].toNumber(),
            highWeightSum: epochResultRaw.weights[2].toNumber(),
            FLRlowWeightSum: epochResultRaw.weights[3].toNumber(),
            FLRrewardedWeightSum: epochResultRaw.weights[4].toNumber(),
            FLRhighWeightSum: epochResultRaw.weights[5].toNumber()
        }
    }
}

////////////////////////////////////////////////////////////
//// PRETTY PRINTOUT FUNCTIONS
////////////////////////////////////////////////////////////

/**
 * Pretty prints raw vote list to the logger.
 * @param voteListRaw 
 * @param logger logger object implementing function log(string). Could be `console` as well.
 */
export function prettyPrintVoteInfo(voteListRaw: VoteListRaw, logger?: any) {
    if (!logger) {
        logger = console;
    }
    let voteList = toVoteList(voteListRaw);
    let totalSumFlr = 0;
    voteList.votes.forEach((a: VoteInfo) => { totalSumFlr += a.weightFlr });
    let totalSumAsset = 0;
    voteList.votes.forEach((a: VoteInfo) => { totalSumAsset += a.weightAsset });
    logger.log(
        `EPOCH ${ voteList.epoch }\nID\tPRICE\tWFLR\tWASSET\tWEIGHT\n` +
        voteList.votes.map(vote => `${ vote.id }\t${ vote.price }\t${ vote.weightFlr }\t${ vote.weightAsset }\t${ totalSumAsset! * vote.weightFlr + totalSumFlr! * vote.weightAsset }`).join("\n")
    );
}

/**
 * Auxilliary function for pretty printing
 * @param i 
 * @param minfo 
 * @returns 
 */
function marker(i: number, minfo: MediansInfo) {
    return "" +
        (i == minfo.firstQuartileIndex ? "<1" : "") +
        (i == minfo.truncatedFirstQuartileIndex ? "<1-" : "") +
        (i == minfo.medianIndex ? "<2" : "") +
        (i == minfo.lastQuartileIndex ? "<3" : "") +
        (i == minfo.truncatedLastQuartileIndex ? "<3+" : "");
}

/**
 * Pretty prints raw epoch result to logger.
 * @param rawEpochResult 
 * @param logger logger object implementing function log(string). Could be `console` as well.
 */
export function prettyPrintEpochResult(rawEpochResult: EpochResultRaw, logger?: any) {
    if (!logger) {
        logger = console;
    }
    let epochResult = toEpochResult(rawEpochResult);
    let totalSumFlr = epochResult.votes.length > 0 ? epochResult.votes[epochResult.votes.length - 1].runningSumFlr! : 0;
    let totalSumAsset = epochResult.votes.length > 0 ? epochResult.votes[epochResult.votes.length - 1].runningSumAsset! : 0;
    // let totalSum = totalSumFlr + totalSumAsset;
    let totalSum = 0;
    epochResult.votes.forEach(vote => {
        totalSum += totalSumAsset * vote.weightFlr + totalSumFlr * vote.weightAsset;
    })
    logger.log(
        `ID\tPRICE\tWFLR\tWASSET\tWEIGHT\n` +
        epochResult.votes.map((vote, i) => `${ vote.id }\t${ vote.price }\t${ vote.weightFlr }\t${ vote.weightAsset }\t${ totalSumAsset * vote.weightFlr + totalSumFlr * vote.weightAsset }\t${ vote.runningSumFlr! + vote.runningSumFlr! }\t${ (vote.runningPct! * 100).toFixed(1) }\t${ marker(i, epochResult.medians) }`).join("\n") +
        "\n" +
        `Epoch ${ epochResult.epoch }\n` +
        `Lower price: ${ epochResult.prices.lowRewardedPrice }\n` +
        `Median price: ${ epochResult.prices.medianPrice }\n` +
        `Higher price: ${ epochResult.prices.highRewardedPrice }\n` +
        `Lower excluded weight: ${ epochResult.weights.lowWeightSum } (${ (epochResult.weights.lowWeightSum / totalSum * 100).toFixed(1) }%)\n` +
        `Rewarded weight: ${ epochResult.weights.rewardedWeightSum } (${ (epochResult.weights.rewardedWeightSum / totalSum * 100).toFixed(1) }%)\n` +
        `Higher excluded weight: ${ epochResult.weights.highWeightSum } (${ (epochResult.weights.highWeightSum / totalSum * 100).toFixed(1) }%)\n` +
        `Total weight: ${ totalSum }\n` +
        `Lower FLR excluded weight: ${ epochResult.weights.FLRlowWeightSum } (${ (epochResult.weights.FLRlowWeightSum / totalSumFlr * 100).toFixed(1) }%)\n` +
        `Rewarded FLR weight: ${ epochResult.weights.FLRrewardedWeightSum } (${ (epochResult.weights.FLRrewardedWeightSum / totalSumFlr * 100).toFixed(1) }%)\n` +
        `Higher FLR excluded weight: ${ epochResult.weights.FLRhighWeightSum } (${ (epochResult.weights.FLRhighWeightSum / totalSumFlr * 100).toFixed(1) }%)\n` +
        `Total FLR weight: ${ totalSumFlr }\n`
    )
}

////////////////////////////////////////////////////////////
//// TEST CHECKING FUNCTIONS
////////////////////////////////////////////////////////////

/**
 * Returns random number with approximate normal distribution centered at `mu` with given `sigma`.
 * @param mu 
 * @param sigma 
 * @returns 
 */
export function normal(mu: number, sigma: number) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random(); //Converting [0,1) to (0,1)
    while (v === 0) v = Math.random();
    let res = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return Math.abs(Math.round(res * sigma + mu))
}

/**
 * Dummy helper function to obtain "random" number from price, used solely in test calls to the contract.
 * @param price 
 * @returns 
 */
export function priceToRandom(price: number) {
    return price + 1000;
}

/**
 * Calculate median and truncated distribution of the test example and prepares target vote result.
 * Truncated weighted distribution is calculated by sorting by price.
 * Result is/can be used as a target result to compare against the test result returned by a smart contract. 
 * @param data 
 * @returns 
 */
export function resultsFromTestData(data: TestExample, addresses: string[]): EpochResult {
    let votes: VoteInfo[] = [];
    let len = data.prices.length;
    if (len != data.weightsFlr.length) throw Error(`Wrong FLR weights length: ${ data.weightsFlr.length }. Should be ${ len }`);
    if (len != data.weightsAsset.length) throw Error(`Wrong FLR weights length: ${ data.weightsAsset.length }. Should be ${ len }`);
    if (len != addresses.length) throw Error(`Wrong addresses length: ${ addresses.length }. Should be ${ len }`);
    let flrSum = 0;
    let assetSum = 0;
    for (let i = 0; i < len; i++) {
        flrSum += data.weightsFlr[i];
        assetSum += data.weightsAsset[i];
        votes.push({
            id: i,
            price: data.prices[i],
            weightFlr: data.weightsFlr[i],
            weightAsset: data.weightsAsset[i],
            address: addresses[i],
            runningSumFlr: flrSum,
            runningSumAsset: assetSum
        })
    }
    votes.sort((a: VoteInfo, b: VoteInfo) => a.price < b.price ? -1 : (a.price > b.price ? 1 : 0));
    let totalPreSum = assetSum + flrSum;
    let totalSum = 0;
    votes.forEach((v: VoteInfo) => {
        let weight = (1000 - data.weightRatio) * assetSum * v.weightFlr + data.weightRatio * flrSum * v.weightAsset;
        v.weight = weight;
        totalSum += weight;
        v.runningPct = weight / totalPreSum;
    })

    let sm = 0
    votes.forEach((v: VoteInfo) => {
        sm += v.weight!;
        v.runningPct = sm / totalSum;
    })


    let medianWeight = Math.floor(totalSum / 2) + totalSum % 2;
    // console.log("SORTED VOTES:", votes, "SUMS", assetSum, flrSum, totalSum, "MV", medianWeight);
    let medianIndex = 0;
    let medianSum = 0;

    while (medianIndex < len) {
        let weight = votes[medianIndex].weight || 0;
        medianSum += weight;
        if (medianSum >= medianWeight) break;
        medianIndex++;
    }

    let firstQuartileWeight = totalSum - Math.floor(totalSum / 4);
    let firstQuartileIndex = len;
    let firstQuartileSum = 0;
    // console.log("MI:", medianIndex, len, votes[medianIndex], medianWeight, "FKW", firstQuartileWeight);

    while (true) {
        if (firstQuartileSum >= firstQuartileWeight || firstQuartileIndex == 0) break;
        firstQuartileIndex--
        let weight = votes[firstQuartileIndex].weight || 0;
        firstQuartileSum += weight;
    }

    let lastQuartileWeight = totalSum - Math.floor(totalSum / 4);
    let lastQuartileIndex = medianIndex;
    let lastQuartileSum = medianSum;

    while (true) {
        if (lastQuartileSum >= lastQuartileWeight || lastQuartileIndex == len - 1) break;
        lastQuartileIndex++;
        let weight = votes[lastQuartileIndex].weight || 0;
        lastQuartileSum += weight;
    }

    let truncatedFirstQuartileIndex = firstQuartileIndex;

    while (truncatedFirstQuartileIndex > 0) {
        if (votes[truncatedFirstQuartileIndex - 1].price != votes[firstQuartileIndex].price) break;
        truncatedFirstQuartileIndex--;
    }

    let truncatedLastQuartileIndex = lastQuartileIndex;

    while (truncatedLastQuartileIndex < len - 1) {
        if (votes[truncatedLastQuartileIndex + 1].price != votes[lastQuartileIndex].price) break;
        truncatedLastQuartileIndex++;
    }

    let lowWeightSum = 0
    let highWeightSum = 0;

    for (let i = truncatedFirstQuartileIndex - 1; i >= 0; i--) {
        lowWeightSum += votes[i].weight!;
    }
    for (let i = truncatedLastQuartileIndex + 1; i < len; i++) {
        highWeightSum += votes[i].weight!;
    }

    let medianPrice = votes[medianIndex].price;
    if (totalSum % 2 == 0 && Math.floor(totalSum / 2) == medianSum && medianIndex < len - 1) {
        medianPrice = Math.floor((medianPrice + votes[medianIndex + 1].price) / 2);
    }

    let rewardedVotes: RewardedVoteInfo[] = [];
    for (let i = truncatedFirstQuartileIndex; i <= truncatedLastQuartileIndex; i++) {
        let voteInfo = votes[i];
        rewardedVotes.push({ weightFlr: voteInfo.weightFlr, address: voteInfo.address! } as RewardedVoteInfo);
    }
    rewardedVotes.sort((a: RewardedVoteInfo, b: RewardedVoteInfo) => a.address.localeCompare(b.address));

    return {
        epoch: 0,
        votes,
        medians: {
            truncatedFirstQuartileIndex,
            firstQuartileIndex,
            medianIndex,
            lastQuartileIndex,
            truncatedLastQuartileIndex
        },
        prices: {
            lowRewardedPrice: votes[truncatedFirstQuartileIndex].price,
            medianPrice: votes[medianIndex].price,
            highRewardedPrice: votes[truncatedLastQuartileIndex].price
        },
        weights: {
            lowWeightSum,
            rewardedWeightSum: totalSum - lowWeightSum - highWeightSum,
            highWeightSum
        },
        rewardedVotes
    } as EpochResult
}

/**
 * Update EpochResult with rewardedVotes from finalizePriceEpochWithResult
 * @param epochResult 
 * @param data 
 * @returns 
 */
export function updateWithRewardedVotesInfo(epochResult: EpochResult, data: any): EpochResult {
    if (data.eligibleAddresses?.length != data.flrWeights?.length) {
        throw Error(`FLR weights length (${ data.flrWeights?.length }) and addresses length (${ data.flrWeights?.length }) should match.`);
    }

    let rewardedVotes: RewardedVoteInfo[] = [];
    for (let i = 0; i < data.eligibleAddresses.length; i++) {
        rewardedVotes.push({ weightFlr: data.flrWeights[i], address: data.eligibleAddresses[i] } as RewardedVoteInfo);
    }
    rewardedVotes.sort((a: RewardedVoteInfo, b: RewardedVoteInfo) => a.address.localeCompare(b.address));

    return { ...epochResult, rewardedVotes };
}

// 

/**
 * Evaluates test result against target result.
 * @param test 
 * @param target 
 * @returns 
 */
export function compareEpochResults(test: EpochResult, target: EpochResult): boolean {
    if (test.votes.length != target.votes.length) {
        console.error(`Vote numbers do not match: ${ test.votes.length } vs. ${ target.votes.length }`);
        return false;
    }

    if (test.prices.medianPrice != target.prices.medianPrice) {
        console.error(`Median prices do not match: ${ test.prices.medianPrice } vs. ${ target.prices.medianPrice }`);
        return false;
    }
    if (test.prices.lowRewardedPrice != target.prices.lowRewardedPrice) {
        console.error(`Low rewarded prices do not match: ${ test.prices.lowRewardedPrice } vs. ${ target.prices.lowRewardedPrice }`);
        console.log(test.prices, target.prices);
        return false;
    }
    if (test.prices.highRewardedPrice != target.prices.highRewardedPrice) {
        console.error(`Low rewarded prices do not match: ${ test.prices.highRewardedPrice } vs. ${ target.prices.highRewardedPrice }`);
        return false;
    }

    if (test.weights.lowWeightSum != target.weights.lowWeightSum) {
        console.error(`Low weight sums do not match: ${ test.weights.lowWeightSum } vs. ${ target.weights.lowWeightSum }`);
        return false;
    }
    if (test.weights.rewardedWeightSum != target.weights.rewardedWeightSum) {
        console.error(`Rewarded weight sums do not match: ${ test.weights.rewardedWeightSum } vs. ${ target.weights.rewardedWeightSum }`);
        return false;
    }
    if (test.weights.highWeightSum != target.weights.highWeightSum) {
        console.error(`High weight sums do not match: ${ test.weights.highWeightSum } vs. ${ target.weights.highWeightSum }`);
        return false;
    }
    if (test.rewardedVotes!.length != target.rewardedVotes!.length) {
        console.error(`Rewarded votes lengths do not match: ${ test.rewardedVotes!.length } vs. ${ target.rewardedVotes!.length }`);
        return false;
    }

    for (let i = 0; i < test.rewardedVotes!.length; i++) {
        if (test.rewardedVotes![i].weightFlr != target.rewardedVotes![i].weightFlr) {
            console.error(`Rewarded votes FLR weights at position ${ i } do not match: ${ test.rewardedVotes![i].weightFlr } vs. ${ target.rewardedVotes![i].weightFlr }`);
            return false;
        }
        if (test.rewardedVotes![i].address != target.rewardedVotes![i].address) {
            console.error(`Rewarded votes addresses at position ${ i } do not match: ${ test.rewardedVotes![i].address } vs. ${ target.rewardedVotes![i].address }`);
            return false;
        }
    }

    return true;
}

/**
 * Checks test case with target and test results.
 * @param testCase 
 * @returns 
 */
export function checkTestCase(testCase: TestCase): boolean {
    if (testCase.testResult) {
        return compareEpochResults(testCase.testResult, testCase.targetResult);
    }
    return false;
}

////////////////////////////////////////////////////////////
//// MISC FUNCTIONS
////////////////////////////////////////////////////////////

/**
 * Account generation from Node.js (usually we `yarn account n` is called from shell)
 * @param n 
 * @returns 
 */
export async function generateAccounts(n: number) {
    return new Promise((resolve: any, reject: any) => {
        exec(`yarn accounts ${ n }`, (error: any, stdout: any, stderr: any) => {
            if (error) {
                reject(error);
                return;
            }
            if (stderr) {
                console.log(`stderr: ${ stderr }`);
                reject(stderr)
                return;
            }
            console.log(`stdout: ${ stdout }`);
            resolve(true);
        })
    })
}

/**
 * Reads test example for testing FTSO.
 * @param fname relative path to the root of the project
 * @returns 
 */
export function readTestData(fname: string): TestExample {
    let example = require(fname) as TestExample;
    return example;
}

export function randomizeExampleGenerator(testExample: TestExample) {
    let len = testExample.randomizedDataCount
    if (!len) throw Error("Not a random text example. 'randomizedDataCount' is 0 or null.")
    testExample.prices = [];
    testExample.weightsAsset = []
    testExample.weightsFlr = []
    for (let i = 0; i < len; i++) {
        testExample.weightsFlr.push(normal(testExample.weightFlrAverage!, testExample.weightFlrSD!));
        testExample.weightsAsset.push(normal(testExample.weightAssetAverage!, testExample.weightAssetSD!));
        testExample.prices.push(normal(testExample.priceAverage!, testExample.priceSD!));
    }

}

/**
 * Helper function for instantiating and deploying a contract by using factory.
 * @param name Name of the contract
 * @param signer signer
 * @param args Constructor params
 * @returns deployed contract instance (promise)
 */
export async function newContract<T>(eth: HardhatEthersHelpers, name: string, signer: Signer, ...args: any[]) {
    const factory = await eth.getContractFactory(name, signer);
    let contractInstance = (await factory.deploy(...args));
    await contractInstance.deployed();
    return contractInstance as unknown as T;
}

/**
 * Sets parameters for shifting time to future. Note: seems like 
 * no block is mined after this call, but the next mined block has
 * the the timestamp equal time + 1 
 * @param time 
 */
export async function increaseTimeTo(eth: HardhatEthersHelpers, time: number) {
    await eth.provider.send("evm_mine", [time]);
}

/**
 * given current epoch it moves blockchain time (hardhat) to the (approx) beginning of the next epoch, given
 * the curent one.
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period, must match to the one set in the FTSO contract
 * @param currentEpoch - current epoch
 */
export async function moveToNextEpochStart(eth: HardhatEthersHelpers, epochStartTimestamp: number, epochPeriod: number, currentEpoch: number) {
    let nextEpochTimestamp = (currentEpoch + 1) * epochPeriod + epochStartTimestamp;
    await increaseTimeTo(eth, nextEpochTimestamp);
}

/**
 * Helper shifting time to the beggining of the next epoch
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period in seconds, must match to the one set in the FTSO contract
 */
export async function moveFromCurrentToNextEpochStart(eth: HardhatEthersHelpers, epochStartTimestamp: number, epochPeriod: number) {
    let blockInfo = await eth.provider.getBlock(await eth.provider.getBlockNumber());
    let currentEpoch = Math.floor((blockInfo.timestamp - epochStartTimestamp) / epochPeriod);
    await moveToNextEpochStart(eth, epochStartTimestamp, epochPeriod, currentEpoch);
}

/**
 * Given an epoch it shifts blockchain time to the begining of the reveal period.
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period in seconds, must match to the one set in the FTSO contract
 * @param epoch - epoch number
 */
export async function moveToRevealStart(eth: HardhatEthersHelpers, epochStartTimestamp: number, epochPeriod: number, epoch: number) {
    await moveToNextEpochStart(eth, epochStartTimestamp, epochPeriod, epoch);
}

/**
 * 
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period in seconds, must match to the one set in the FTSO contract
 * @param revealPeriod - reveal period in seconds, must match to the one set in the FTSO contract
 * @param epoch 
 */
export async function moveToFinalizeStart(eth: HardhatEthersHelpers, epochStartTimestamp: number, epochPeriod: number, revealPeriod: number, epoch: number) {
    let finalizeTimestamp = (epoch + 1) * epochPeriod + epochStartTimestamp + revealPeriod + 1;
    await increaseTimeTo(eth, finalizeTimestamp);
}
