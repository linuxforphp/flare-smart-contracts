/**
 * Contains misc functions for testing FTSO oracle results.
 */

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import { ethers, web3 } from "hardhat";
import { Ftso, MockFtso, MockVPToken } from "../../typechain";import { FlareBlock, increaseTimeTo, newContract, waitFinalize } from "./test-helpers";
import { TestExampleLogger } from "./TestExampleLogger";

const { exec } = require("child_process");
const { soliditySha3 } = require("web3-utils");


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
    description?: string;
    randomizedPivot?: boolean;
    /**
     * if this is > 0, then weightsFlr and weightsAsset should be empty [], and this number of pricess/weights is 
     * generated acording to *Averate and *SD parameters, which should be provided 
     */
    randomizedDataCount?: number;
    prices: number[];
    weightsFlr: number[];
    weightsAsset: number[];
    weightRatio?: number,
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
export function prettyPrintVoteInfo(voteListRaw: VoteListRaw, weightRatio: number, logger?: any) {
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
        voteList.votes.map(vote => `${ vote.id }\t${ vote.price }\t${ vote.weightFlr }\t${ vote.weightAsset }\t${ calculateWeight(vote, weightRatio, totalSumFlr, totalSumAsset) }`).join("\n")
    );
}

function calculateWeight(vote:VoteInfo, weightRatio: number, totalSumFlr: number, totalSumAsset: number): number {
    let weight;
    if (totalSumAsset == 0) {
        weight = vote.weightFlr;
    } else if (totalSumFlr == 0) {
        weight = vote.weightAsset;
    } else {
        let BIPS100 = 1e4;
        let flrShare = Math.floor(((BIPS100 - weightRatio) * totalSumAsset) / BIPS100);
        let assetShare = Math.floor((weightRatio * totalSumFlr) / BIPS100);            
        weight = flrShare * vote.weightFlr + assetShare * vote.weightAsset;
    }
    return weight;
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
export function prettyPrintEpochResult(rawEpochResult: EpochResultRaw, weightRatio: number, logger?: any) {
    if (!logger) {
        logger = console;
    }
    let epochResult = toEpochResult(rawEpochResult);
    let totalSumFlr = epochResult.votes.length > 0 ? epochResult.votes[epochResult.votes.length - 1].runningSumFlr! : 0;
    let totalSumAsset = epochResult.votes.length > 0 ? epochResult.votes[epochResult.votes.length - 1].runningSumAsset! : 0;
    // let totalSum = totalSumFlr + totalSumAsset;
    let totalSum = 0;
    epochResult.votes.forEach(vote => {
        totalSum += calculateWeight(vote, weightRatio, totalSumFlr, totalSumAsset);
    })
    logger.log(
        `ID\tPRICE\tWFLR\tWASSET\tWEIGHT\n` +
        epochResult.votes.map((vote, i) => `${ vote.id }\t${ vote.price }\t${ vote.weightFlr }\t${ vote.weightAsset }\t${ calculateWeight(vote, weightRatio, totalSumFlr, totalSumAsset) }\t${ vote.runningSumFlr! + vote.runningSumAsset! }\t${ (vote.runningPct! * 100).toFixed(1) }\t${ marker(i, epochResult.medians) }`).join("\n") +
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
    if (len != data.weightsAsset.length) throw Error(`Wrong Asset weights length: ${ data.weightsAsset.length }. Should be ${ len }`);
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
    let totalSum = 0;
    votes.forEach((v: VoteInfo) => {
        let weight = calculateWeight(v, data.weightRatio!, flrSum, assetSum);
        v.weight = weight;
        totalSum += weight;
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
        if (voteInfo.weightFlr > 0) {
            rewardedVotes.push({ weightFlr: voteInfo.weightFlr, address: voteInfo.address! } as RewardedVoteInfo);
        }
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
            medianPrice,
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
    if (data._eligibleAddresses?.length != data._flrWeights?.length) {
        throw Error(`FLR weights length (${ data._flrWeights?.length }) and addresses length (${ data._flrWeights?.length }) should match.`);
    }

    let rewardedVotes: RewardedVoteInfo[] = [];
    for (let i = 0; i < data._eligibleAddresses.length; i++) {
        rewardedVotes.push({ weightFlr: data._flrWeights[i], address: data._eligibleAddresses[i] } as RewardedVoteInfo);
    }
    rewardedVotes.sort((a: RewardedVoteInfo, b: RewardedVoteInfo) => a.address.localeCompare(b.address));

    return { ...epochResult, rewardedVotes };
}

/**
 * Checks test case with target and test results.
 * @param testCase 
 * @returns 
 */
export function checkTestCase(testCase: TestCase) {
    expect(testCase.testResult).to.exist;
    compareEpochResults(testCase.testResult!, testCase.targetResult);
}

/**
 * Evaluates test result against target result.
 * @param test 
 * @param target 
 * @returns 
 */
export function compareEpochResults(test: EpochResult, target: EpochResult) {
    expect(test.votes.length, "Vote numbers do not match").to.equal(target.votes.length);
    // firstQuartileIndex, medianIndex and lastQuartileIndex should not be included in tests as sorting may produce different permutiations of votes (indexes) with equal prices
    // expect(test.medians.firstQuartileIndex, "Median first quartile indexes do not match").to.equal(target.medians.firstQuartileIndex);
    // expect(test.medians.medianIndex, "Median indexes do not match").to.equal(target.medians.medianIndex);
    // expect(test.medians.lastQuartileIndex, "Median last quartile indexes do not match").to.equal(target.medians.lastQuartileIndex);
    expect(test.medians.truncatedFirstQuartileIndex, "Median truncated first quartile indexes do not match").to.equal(target.medians.truncatedFirstQuartileIndex);
    expect(test.medians.truncatedLastQuartileIndex, "Median truncated last quartile indexes do not match").to.equal(target.medians.truncatedLastQuartileIndex);

    checkVotePricesSort(test);
    checkVotePricesSort(target);

    expect(test.prices.medianPrice, "Median prices do not match").to.equal(target.prices.medianPrice);
    expect(test.prices.lowRewardedPrice, "Low rewarded prices do not match").to.equal(target.prices.lowRewardedPrice);
    expect(test.prices.highRewardedPrice, "High rewarded prices do not match").to.equal(target.prices.highRewardedPrice);
    expect(test.weights.lowWeightSum, "Low weight sums do not match").to.equal(target.weights.lowWeightSum);
    expect(test.weights.rewardedWeightSum, "Rewarded weight sums do not match").to.equal(target.weights.rewardedWeightSum);
    expect(test.weights.highWeightSum, "High weight sums do not match").to.equal(target.weights.highWeightSum);
    expect(test.rewardedVotes!.length, "Rewarded votes lengths do not match").to.equal(target.rewardedVotes!.length);
    for (let i = 0; i < test.rewardedVotes!.length; i++) {
        expect(test.rewardedVotes![i].weightFlr, `Rewarded votes FLR weights at position ${ i } do not match`).to.equal(target.rewardedVotes![i].weightFlr);
        expect(test.rewardedVotes![i].address, `Rewarded votes addresses at position ${ i } do not match:`).to.equal(target.rewardedVotes![i].address);
    }
}

/**
 * Checks vote prices sorting results.
 * @param testCase 
 * @returns 
 */
export function checkVotePricesSort(result: EpochResult) {
    const truncatedFirstQuartileIndex = result.medians.truncatedFirstQuartileIndex;
    const firstQuartileIndex = result.medians.firstQuartileIndex;
    const medianIndex = result.medians.medianIndex;
    const lastQuartileIndex = result.medians.lastQuartileIndex;
    const truncatedLastQuartileIndex = result.medians.truncatedLastQuartileIndex;

    expect(truncatedFirstQuartileIndex).to.be.lte(firstQuartileIndex);
    expect(firstQuartileIndex).to.be.lte(medianIndex);
    expect(medianIndex).to.be.lte(lastQuartileIndex);
    expect(lastQuartileIndex).to.be.lte(truncatedLastQuartileIndex);

    const truncatedFirstQuartilePrice = result.votes[truncatedFirstQuartileIndex].price;
    const firstQuartilePrice = result.votes[firstQuartileIndex].price;
    const medianPrice = result.votes[medianIndex].price;
    const lastQuartilePrice = result.votes[lastQuartileIndex].price;
    const truncatedLastQuartilePrice = result.votes[truncatedLastQuartileIndex].price;

    expect(truncatedFirstQuartilePrice).to.be.equal(firstQuartilePrice);
    expect(firstQuartilePrice).to.be.lte(medianPrice);
    expect(medianPrice).to.be.lte(lastQuartilePrice);
    expect(lastQuartilePrice).to.be.equal(truncatedLastQuartilePrice);

    for (let i = 0; i < truncatedFirstQuartileIndex; i++) {
        expect(result.votes[i].price).to.be.lt(truncatedFirstQuartilePrice);
    }
    for (let i = truncatedFirstQuartileIndex; i <= firstQuartileIndex; i++) {
        expect(result.votes[i].price).to.be.equal(truncatedFirstQuartilePrice);
    }
    for (let i = firstQuartileIndex; i <= medianIndex; i++) {
        expect(result.votes[i].price).to.be.gte(truncatedFirstQuartilePrice);
        expect(result.votes[i].price).to.be.lte(medianPrice);
    }
    for (let i = medianIndex; i <= lastQuartileIndex; i++) {
        expect(result.votes[i].price).to.be.gte(medianPrice);
        expect(result.votes[i].price).to.be.lte(truncatedLastQuartilePrice);
    }
    for (let i = lastQuartileIndex; i <= truncatedLastQuartileIndex; i++) {
        expect(result.votes[i].price).to.be.equal(truncatedLastQuartilePrice);
    }
    for (let i = truncatedLastQuartileIndex + 1; i < result.votes.length; i++) {
        expect(result.votes[i].price).to.be.gt(truncatedLastQuartilePrice);
    }
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

export function randomizePriceGenerator(testExample: TestExample) {
    let len = testExample.randomizedDataCount
    if (!len) throw Error("Not a random text example. 'randomizedDataCount' is 0 or null.")
    testExample.prices = [];
    for (let i = 0; i < len; i++) {
        testExample.prices.push(normal(testExample.priceAverage!, testExample.priceSD!));
    }
}



/**
 * given current epoch it moves blockchain time (hardhat) to the (approx) beginning of the next epoch, given
 * the curent one.
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period, must match to the one set in the FTSO contract
 * @param currentEpoch - current epoch
 */
export async function moveToNextEpochStart(epochStartTimestamp: number, epochPeriod: number, currentEpoch: number, offset = 0) {
    let nextEpochTimestamp = (currentEpoch + 1) * epochPeriod + epochStartTimestamp + offset;
    await increaseTimeTo(nextEpochTimestamp);
}

/**
 * Helper shifting time to the beggining of the next epoch
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period in seconds, must match to the one set in the FTSO contract
 * @returns new epochId
 */
export async function moveFromCurrentToNextEpochStart(epochStartTimestamp: number, epochPeriod: number, offset = 0): Promise<number> {
    let blockInfo = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
    let currentEpoch = Math.floor((blockInfo.timestamp - epochStartTimestamp) / epochPeriod);
    await moveToNextEpochStart(epochStartTimestamp, epochPeriod, currentEpoch, offset);
    return currentEpoch + 1;
}

/**
 * Given an epoch it shifts blockchain time to the begining of the reveal period.
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period in seconds, must match to the one set in the FTSO contract
 * @param epoch - epoch number
 */
export async function moveToRevealStart(epochStartTimestamp: number, epochPeriod: number, epoch: number) {
    await moveToNextEpochStart(epochStartTimestamp, epochPeriod, epoch);
}

/**
 * 
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period in seconds, must match to the one set in the FTSO contract
 * @param revealPeriod - reveal period in seconds, must match to the one set in the FTSO contract
 * @param epoch 
 */
export async function moveToFinalizeStart(epochStartTimestamp: number, epochPeriod: number, revealPeriod: number, epoch: number) {
    let finalizeTimestamp = (epoch + 1) * epochPeriod + epochStartTimestamp + revealPeriod + 1;
    await increaseTimeTo(finalizeTimestamp);
}

/**
 * get epoch period
 * @param len 
 * @returns 
 */
export function getEpochPeriod(len: number): number {
    return len + 10;
}

/**
 * get reveal period
 * @param len 
 * @returns 
 */
export function getRevealPeriod(len: number): number {
    return len + 10;
}

/**
 * test ftso median process - init data and deploy contracts
 * @param epochStartTimestamp
 * @param signers 
 * @param testExample 
 * @returns 
 */
export async function testFTSOInitContracts(epochStartTimestamp: number, signers: readonly SignerWithAddress[], testExample: TestExample): Promise<MockFtso> {
    // init, data preparation
    let isRandomized = !!testExample.randomizedDataCount
    let len = isRandomized ? testExample.randomizedDataCount! : testExample.prices.length;
    let epochPeriod = getEpochPeriod(len);
    let revealPeriod = getRevealPeriod(len);
    if (len == 0) {
        throw Error(`Bad example file ${ testExample.fileName }. Length 0.`);
    }
    if (isRandomized) {
        randomizeExampleGenerator(testExample)
    }
    if (signers.length < len) throw Error(`To few accounts/signers: ${ signers.length }. Required ${ len }.`);

    // Contract deployment
    let flrToken = await newContract<MockVPToken>("MockVPToken", signers[0],
        signers.slice(0, len).map(signer => signer.address), testExample.weightsFlr
    )
    let assetToken = await newContract<MockVPToken>("MockVPToken", signers[0],
        signers.slice(0, len).map(signer => signer.address), testExample.weightsAsset
    )
    let ftso = await newContract<MockFtso>("MockFtso", signers[0],
        flrToken.address, assetToken.address, signers[0].address,  // address _fFlr, address _fAsset,
        // testExample.randomizedPivot, // bool _randomizedPivot
        epochStartTimestamp, // uint256 _startTimestamp
        epochPeriod, revealPeriod //uint256 _epochPeriod, uint256 _revealPeriod
    );

    return ftso;
}

/**
 * test ftso median process - submit price, reveal price, finalize and check results
 * @param epochStartTimestamp 
 * @param signers 
 * @param ftso 
 * @param testExample 
 * @returns 
 */
export async function testFTSOMedian(epochStartTimestamp: number, signers: readonly SignerWithAddress[], ftso: Ftso, testExample: TestExample): Promise<TestCase> {
    let len = testExample.prices.length;
    return testFTSOMedian2(epochStartTimestamp, getEpochPeriod(len), getRevealPeriod(len), signers, ftso, testExample);
}

/**
 * test ftso median process - submit price, reveal price, finalize and check results
 * @param epochStartTimestamp 
 * @param epochPeriod 
 * @param revealPeriod 
 * @param signers 
 * @param ftso 
 * @param testExample 
 * @returns 
 */
export async function testFTSOMedian2(epochStartTimestamp: number, epochPeriod: number, revealPeriod: number, signers: readonly SignerWithAddress[], ftso: Ftso, testExample: TestExample): Promise<TestCase> {
    let logger = new TestExampleLogger(testExample);
    await ftso.setCurrentPrice(1);

    let len = testExample.prices.length;

    // Submit price
    await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
    logger.log(`EPOCH 1: ${ (await ftso.getCurrentEpochId()).toNumber() }`);
    logger.log(`SUBMIT PRICE ${ len }`);
    const { epoch } = await submitPrice(signers, ftso, testExample.prices);

    await ftso.initializeCurrentEpochStateForReveal();

    // Reveal price
    await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
    logger.log(`EPOCH 2: ${ (await ftso.getCurrentEpochId()).toNumber() }`);
    logger.log(`REVEAL PRICE ${ len }`)
    await revealPrice(signers, ftso, testExample.prices, epoch);

    // Print epoch submission prices
    let resVoteInfo = await ftso.getVoteInfo(epoch);
    testExample.weightRatio = (await ftso.getWeightRatio(epoch)).toNumber();
    prettyPrintVoteInfo(resVoteInfo, testExample.weightRatio!, logger);

    // Finalize
    await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
    let epochFinalizeResponse = await finalizePriceEpochWithResult(signers[0], ftso, epoch);
    logger.log(`epoch finalization, ${ len }`);
    
    // Print results                
    let res = await ftso.getEpochResult(epoch);
    prettyPrintEpochResult(res, testExample.weightRatio!, logger);
    let voterRes = toEpochResult(res);
    let testCase = {
        example: testExample,
        targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
        testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
    } as TestCase;

    return testCase;
}

export async function submitPrice(signers: readonly SignerWithAddress[], ftso: Ftso, prices: number[]): Promise<{ epoch: number; }> {
    const len = prices.length;
    let promises = [];
    let epochs: number[] = [];
    for (let i = 0; i < len; i++) {
        let price = prices[i];
        let random = priceToRandom(price);
        // TODO: try to the use correct hash from ethers.utils.keccak256
        //let hash = ethers.utils.keccak256(ethers.utils.solidityKeccak256([ "uint256", "uint256" ], [ price, random ]))
        let hash = soliditySha3(price, random);
        promises.push(waitFinalize(signers[i], async () =>
            ftso.connect(signers[i]).submitPrice(hash)
        ));
    }
    (await Promise.all(promises)).forEach(res => {
        epochs.push((res.events![0].args![1] as BigNumber).toNumber());
    });
    let uniqueEpochs: number[] = [...(new Set(epochs))];
    expect(uniqueEpochs.length, `Too short epoch for the test. Increase epochPeriod.`).to.equal(1);

    return { epoch: uniqueEpochs[0] };
}

export async function revealPrice(signers: readonly SignerWithAddress[], ftso: Ftso, prices: number[], epoch: number) {
    const len = prices.length;
    let epochPromises = [];
    for (let i = 0; i < len; i++) {
        epochPromises.push(
            waitFinalize(signers[i], async () => {
                let res = await ftso.connect(signers[i]).revealPrice(epoch, prices[i], priceToRandom(prices[i]))
                // console.log("I:", i);
                return res
            })
        )
    }
    await Promise.all(epochPromises);
}

/**
 * Use call to get result and then send transaction as it does not emit an event
 * @param signer reward manager
 * @param ftso contract
 * @param epochId epoch id
 * @returns finalize price epoch result (_eligibleAddresses, _flrWeights, _flrWeightsSum)
 */
export async function finalizePriceEpochWithResult(signer: SignerWithAddress, ftso: Ftso, epochId: number): Promise<{ _eligibleAddresses: string[]; _flrWeights: BigNumber[]; _flrWeightsSum: BigNumber; }> {
    let epochFinalizeResponse = await ftso.connect(signer).callStatic.finalizePriceEpoch(epochId, true);
    await waitFinalize(signer, () => ftso.connect(signer).finalizePriceEpoch(epochId, true));
    return epochFinalizeResponse;
}