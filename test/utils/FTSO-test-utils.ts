/**
 * Contains misc functions for testing FTSO oracle results.
 */

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { Ftso, MockFtso, MockVPToken } from "../../typechain";
import { FtsoManagerContract, FtsoManagerInstance, FtsoRewardManagerInstance, MockContractContract, MockContractInstance } from "../../typechain-truffle";
import { computeVoteRandom, increaseTimeTo, isAddressEligible, newContract, submitPriceHash, toBN, waitFinalize } from "./test-helpers";
import { TestExampleLogger } from "./TestExampleLogger";
import { setDefaultVPContract_ethers } from "./token-test-helpers";

const { exec } = require("child_process");
import { constants, time } from '@openzeppelin/test-helpers';
const MockFtsoManager = artifacts.require("MockContract") as MockContractContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days

////////////////////////////////////////////////////////////
//// INTERFACES
////////////////////////////////////////////////////////////

/**
 * Auxiliary interface for JSON returned by FTSO function `getEpochVotes`
 */
export interface VoteListRaw {
    _voters: string[];
    _prices: BigNumber[];
    _weights: BigNumber[];
    _weightsFlr: BigNumber[];
    _weightsAsset: BigNumber[];
    _eligibleForReward: boolean[];
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

/**
 * Auxiliary interface for JSON returned by FTSO function `getFullEpochReport`
 */
export interface EpochResultRaw {
    _epochSubmitStartTime: BigNumber;
    _epochSubmitEndTime: BigNumber;
    _epochRevealEndTime: BigNumber;
    _epochFinalizedTimestamp: BigNumber;
    _price: BigNumber;
    _lowRewardPrice: BigNumber;
    _highRewardPrice: BigNumber;
    _numberOfVotes: BigNumber;
    _votePowerBlock: BigNumber;
    _finalizationType: number;
    _trustedAddresses: string[];
    _rewardedFtso: boolean;
    _fallbackMode: boolean;
}

/**
 * Stores indices of position of a median and positions relevant to (truncated) weighted median.
 */
export interface MediansInfo {
    truncatedFirstQuartileIndex: number;
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
export function toVoteList(voteList: VoteListRaw): VoteInfo[] {

    let votes: VoteInfo[] = [];
    for (let i = 0; i < voteList._prices.length; i++) {
        votes.push({
            id: i,
            price: voteList._prices[i].toNumber(),
            weightFlr: voteList._weightsFlr[i].toNumber(),
            weightAsset: voteList._weightsAsset[i].toNumber(),
        });
    }

    return votes;
}

/**
 * Conversion function from interface `EpochResultRaw` to `EpochResult`. 
 * @param epochResultRaw 
 * @returns 
 */
export function toEpochResult(epochResultRaw: EpochResultRaw, votesRaw: VoteListRaw): EpochResult {
    let votes: VoteInfo[] = [];

    let lowWeightSum = 0;
    let rewardedWeightSum = 0;
    let highWeightSum = 0;
    let FLRlowWeightSum = 0;
    let FLRrewardedWeightSum = 0;
    let FLRhighWeightSum = 0;
    let truncatedFirstQuartileIndex = 0;
    let truncatedLastQuartileIndex = votesRaw._prices.length - 1;

    for (let i = 0; i < votesRaw._prices.length; i++) {
        if (votesRaw._prices[i].toNumber() < epochResultRaw._lowRewardPrice.toNumber()) {
            lowWeightSum += votesRaw._weights[i].toNumber();
            FLRlowWeightSum += votesRaw._weightsFlr[i].toNumber();
            truncatedFirstQuartileIndex++;
        } else if (votesRaw._prices[i].toNumber() > epochResultRaw._highRewardPrice.toNumber()) {
            highWeightSum += votesRaw._weights[i].toNumber();
            FLRhighWeightSum += votesRaw._weightsFlr[i].toNumber();
            truncatedLastQuartileIndex--;
        } else {
            rewardedWeightSum += votesRaw._weights[i].toNumber();
            FLRrewardedWeightSum += votesRaw._weightsFlr[i].toNumber();
        }
        votes.push({
            id: i,
            price: votesRaw._prices[i].toNumber(),
            weightFlr: votesRaw._weightsFlr[i].toNumber(),
            weightAsset: votesRaw._weightsAsset[i].toNumber(),
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
        votes: votes,
        medians: {
            truncatedFirstQuartileIndex,
            truncatedLastQuartileIndex
        },
        prices: {
            lowRewardedPrice: epochResultRaw._lowRewardPrice.toNumber(),
            medianPrice: epochResultRaw._price.toNumber(),
            highRewardedPrice: epochResultRaw._highRewardPrice.toNumber()
        },
        weights: {
            lowWeightSum,
            rewardedWeightSum,
            highWeightSum,
            FLRlowWeightSum,
            FLRrewardedWeightSum,
            FLRhighWeightSum
        }
    }
}

export function arraySum(array: BigNumber[]): BigNumber {
    let result = BigNumber.from(0);
    for (const num of array) {
        result = result.add(num);
    }
    return result;
}

////////////////////////////////////////////////////////////
//// PRETTY PRINTOUT FUNCTIONS
////////////////////////////////////////////////////////////

/**
 * Pretty prints raw vote list to the logger.
 * @param voteListRaw 
 * @param logger logger object implementing function log(string). Could be `console` as well.
 */
export function prettyPrintVoteInfo(epoch: number, voteListRaw: VoteListRaw, weightRatio: number, logger?: any) {
    if (!logger) {
        logger = console;
    }
    let voteList = toVoteList(voteListRaw);
    let totalSumFlr = 0;
    voteList.forEach((a: VoteInfo) => { totalSumFlr += a.weightFlr });
    let totalSumAsset = 0;
    voteList.forEach((a: VoteInfo) => { totalSumAsset += a.weightAsset });
    
    logger.log(
        `EPOCH ${ epoch }\nID\tPRICE\tWFLR\tWASSET\tWEIGHT\n` +
        voteList.map(vote => `${ vote.id }\t${ vote.price }\t${ vote.weightFlr }\t${ vote.weightAsset }\t${ calculateWeight(vote, weightRatio, totalSumFlr, totalSumAsset) }`).join("\n")
    );
}

function calculateWeight(vote:VoteInfo, weightRatio: number, totalSumFlr: number, totalSumAsset: number): number {
    let TERA = 1e12;
    let BIPS100 = 1e4;

    // set weight distribution according to weight sums and weight ratio
    let weightFlrShare = 0;
    let weightAssetShare = weightRatio;        
    if (totalSumFlr > 0) {
        weightFlrShare = BIPS100 - weightAssetShare;
    }

    let weightFlr = 0;
    if (weightFlrShare > 0) {
        weightFlr = Math.floor((weightFlrShare * TERA * vote.weightFlr) / (totalSumFlr * BIPS100));
    }

    let weightAsset = 0;
    if (weightAssetShare > 0) {
        weightAsset = Math.floor((weightAssetShare * TERA * vote.weightAsset) / (totalSumAsset * BIPS100));
    }

    return weightFlr + weightAsset;
}

/**
 * Auxilliary function for pretty printing
 * @param i 
 * @param minfo 
 * @returns 
 */
function marker(i: number, minfo: MediansInfo) {
    return "" +
        // (i == minfo.firstQuartileIndex ? "<1" : "") +
        (i == minfo.truncatedFirstQuartileIndex ? "<1-" : "") +
        // (i == minfo.medianIndex ? "<2" : "") +
        // (i == minfo.lastQuartileIndex ? "<3" : "") +
        (i == minfo.truncatedLastQuartileIndex ? "<3+" : "");
}

/**
 * Pretty prints raw epoch result to logger.
 * @param rawEpochResult 
 * @param logger logger object implementing function log(string). Could be `console` as well.
 */
export function prettyPrintEpochResult(epoch: number, rawEpochResult: EpochResultRaw, rawVotes: VoteListRaw, weightRatio: number, logger?: any) {
    if (!logger) {
        logger = console;
    }
    let epochResult = toEpochResult(rawEpochResult, rawVotes);
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
        `Epoch ${ epoch }\n` +
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
export function resultsFromTestData(data: TestExample, addresses: string[], flrSumOverride: number = 0, assetSumOverride: number = 0, logger?: any): EpochResult {
    if (!logger) {
        logger = console;
    }
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
    }
    let TERA = 1e12;
    let flrWeightSum = 0;
    let assetWeightSum = 0;
    let price_random = [];
    for (let i = 0; i < len; i++) {
        let flrWeight: number;
        if (flrSumOverride > 0) {
            flrWeight = Math.floor((data.weightsFlr[i] * TERA) / flrSumOverride);
        } else {
            flrWeight = flrSum == 0 ? 0 : Math.floor((data.weightsFlr[i] * TERA) / flrSum);
        }
        flrWeightSum += flrWeight;
        let assetWeight: number;
        if (assetSumOverride > 0) {
            assetWeight = Math.floor((data.weightsAsset[i] * TERA) / assetSumOverride);
        } else {
            assetWeight = assetSum == 0 ? 0 : Math.floor((data.weightsAsset[i] * TERA) / assetSum);
        }
        assetWeightSum += assetWeight
        let price = data.prices[i];
        votes.push({
            id: i,
            price: price,
            weightFlr: flrWeight,
            weightAsset: assetWeight,
            address: addresses[i],
            runningSumFlr: flrWeightSum,
            runningSumAsset: assetWeightSum
        })
        price_random.push([price, priceToRandom(price)]);
    }
    votes.sort((a: VoteInfo, b: VoteInfo) => a.price < b.price ? -1 : (a.price > b.price ? 1 : 0));
    let totalSum = 0;
    votes.forEach((v: VoteInfo) => {
        let weight = calculateWeight(v, data.weightRatio!, flrWeightSum, assetWeightSum);
        v.weight = weight;
        totalSum += weight;
    })

    let sm = 0
    votes.forEach((v: VoteInfo) => {
        sm += v.weight!;
        v.runningPct = sm / totalSum;
    })


    let medianWeight = Math.floor(totalSum / 2) + totalSum % 2;
    logger.log(
        `Sorted votes:\nID\tPRICE\tWFLR\tWASSET\n` +
        votes.map(vote => `${ vote.id }\t${ vote.price }\t${ vote.weightFlr }\t${ vote.weightAsset }`).join("\n")
    );
    logger.log(`SUMS: ${ assetSum }, ${ flrSum }, ${ totalSum }, MV: ${ medianWeight.toString() }`);
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
    logger.log(`MI: ${ medianIndex }, ${ len }, ${ votes[medianIndex].toString() }, ${ medianWeight }, FKW: ${ firstQuartileWeight }`);

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
    let truncatedFirstQuartilePrice = votes[truncatedFirstQuartileIndex].price;

    let truncatedLastQuartileIndex = lastQuartileIndex;

    while (truncatedLastQuartileIndex < len - 1) {
        if (votes[truncatedLastQuartileIndex + 1].price != votes[lastQuartileIndex].price) break;
        truncatedLastQuartileIndex++;
    }
    let truncatedLastQuartilePrice = votes[truncatedLastQuartileIndex].price;

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
    let random = toBN(computeVoteRandom(price_random));
    logger.log(`Computed FTSO random: ${ random.toString() }`);
    let rewardedVotes: RewardedVoteInfo[] = [];
    logger.log("Start filtering the reward addresses")
    for (let i = truncatedFirstQuartileIndex; i <= truncatedLastQuartileIndex; i++) {
        let voteInfo = votes[i];
        logger.log(`Considering ${ voteInfo.id }\t${ voteInfo.price }\t${ voteInfo.weightFlr }\t${ voteInfo.weightAsset }\t${ voteInfo.address! }`)
        if (voteInfo.weightFlr > 0) {
            if (voteInfo.price == truncatedFirstQuartilePrice || voteInfo.price == truncatedLastQuartilePrice) {
                logger.log("\tEdge case");
                if (!isAddressEligible(random, voteInfo.address!)) {
                    logger.log(`\t\t=> Address ${ voteInfo.address! } not chosen, price = ${ voteInfo.price }`);
                    continue;
                }
            }
            rewardedVotes.push({ weightFlr: voteInfo.weightFlr, address: voteInfo.address! } as RewardedVoteInfo);
        }
    }
    logger.log("Done filtering the reward addresses");
    rewardedVotes.sort((a: RewardedVoteInfo, b: RewardedVoteInfo) => a.address.localeCompare(b.address));
    logger.log(`Rewarded:` + rewardedVotes.map(rewarded => `${ rewarded.address }`).join(`, `));

    return {
        votes,
        medians: {
            truncatedFirstQuartileIndex,
            truncatedLastQuartileIndex
        },
        prices: {
            lowRewardedPrice: truncatedFirstQuartilePrice,
            medianPrice,
            highRewardedPrice: truncatedLastQuartilePrice
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
    const truncatedLastQuartileIndex = result.medians.truncatedLastQuartileIndex;

    expect(truncatedFirstQuartileIndex).to.be.lte(truncatedLastQuartileIndex);

    const truncatedFirstQuartilePrice = result.votes[truncatedFirstQuartileIndex].price;
    const truncatedLastQuartilePrice = result.votes[truncatedLastQuartileIndex].price;

    expect(truncatedFirstQuartilePrice).to.be.lte(truncatedLastQuartilePrice);

    for (let i = 0; i < truncatedFirstQuartileIndex; i++) {
        expect(result.votes[i].price).to.be.lt(truncatedFirstQuartilePrice);
    }
    for (let i = truncatedFirstQuartileIndex; i <= truncatedLastQuartileIndex; i++) {
        expect(result.votes[i].price).to.be.gte(truncatedFirstQuartilePrice);
        expect(result.votes[i].price).to.be.lte(truncatedLastQuartilePrice);
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

export async function createMockSupplyContract(address: string, circulatingSupply: number): Promise<MockContractInstance> {
    const Supply = artifacts.require("Supply");
    const MockSupply = artifacts.require("MockContract");

    let supplyInterface = await Supply.new(address, constants.ZERO_ADDRESS, address, 1000, 0, []);
    let mockSupply = await MockSupply.new();
    const getCirculatingSupplyAtCached = supplyInterface.contract.methods.getCirculatingSupplyAtCached(0).encodeABI();
    const getCirculatingSupplyAtCachedReturn = web3.eth.abi.encodeParameter('uint256', circulatingSupply);
    await mockSupply.givenMethodReturn(getCirculatingSupplyAtCached, getCirculatingSupplyAtCachedReturn);

    return mockSupply;
}

/**
 * given current epoch it moves blockchain time (hardhat) to the (approx) beginning of the next epoch, given
 * the curent one.
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period, must match to the one set in the FTSO contract
 * @param currentEpoch - current epoch
 */
export async function moveToNextEpochStart(epochStartTimestamp: number, epochPeriod: number, currentEpoch: number, offset = 1) {
    let nextEpochTimestamp = (currentEpoch + 1) * epochPeriod + epochStartTimestamp + offset;
    await increaseTimeTo(nextEpochTimestamp);
}

/**
 * Helper shifting time to the beggining of the next epoch
 * @param epochStartTimestamp - start timemestamp from when epoch are counted, must match to the one set in the FTSO contract
 * @param epochPeriod - epoch period in seconds, must match to the one set in the FTSO contract
 * @returns new epochId
 */
export async function moveFromCurrentToNextEpochStart(epochStartTimestamp: number, epochPeriod: number, offset = 1): Promise<number> {
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
 * @param epoch - epoch number
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
    return len + 20;
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

    let mockSupply = await createMockSupplyContract(signers[0].address, 1000);

    let ftso = await newContract<MockFtso>("MockFtso", signers[0],
        assetToken._symbol(), flrToken.address, signers[0].address, mockSupply.address,  // address _wFlr, address _fAsset, address _supply
        // testExample.randomizedPivot, // bool _randomizedPivot
        epochStartTimestamp, // uint256 _startTimestamp
        epochPeriod, revealPeriod, //uint256 _epochPeriod, uint256 _revealPeriod
        1, //uint256 _initialPrice
        1e10
    );
    await ftso.setFAsset(assetToken.address);

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
export async function testFTSOMedian(epochStartTimestamp: number, signers: readonly SignerWithAddress[], ftso: MockFtso, testExample: TestExample): Promise<TestCase> {
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
export async function testFTSOMedian2(epochStartTimestamp: number, epochPeriod: number, revealPeriod: number, signers: readonly SignerWithAddress[], ftso: MockFtso, testExample: TestExample): Promise<TestCase> {
    const logger = new TestExampleLogger(testExample);
    let len = testExample.prices.length;

    // Submit price
    // CCB: I added an offset to prevent test from occasionally failing due to timing skew.
    await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod, 1);
    logger.log(`EPOCH 1: ${ (await ftso.getCurrentEpochId()).toNumber() }`);
    logger.log(`SUBMIT PRICE ${ len }`);
    const { epoch } = await submitPrice(signers, ftso, testExample.prices);

    await ftso.initializeCurrentEpochStateForReveal(false);

    // Reveal price
    await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
    logger.log(`EPOCH 2: ${ (await ftso.getCurrentEpochId()).toNumber() }`);
    logger.log(`REVEAL PRICE ${ len }`)
    await revealPrice(signers, ftso, testExample.prices, epoch);

    let random = await ftso.getCurrentRandom();
    logger.log(`AFTER REVEAL, test RANDOM = ${ random }`);

    // Finalize
    await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
    let epochFinalizeResponse = await finalizePriceEpochWithResult(signers[0], ftso, epoch);
    logger.log(`Rewarded addresses ${ epochFinalizeResponse._eligibleAddresses }`);
    logger.log(`epoch finalization, ${ len }`);
        
    // Print epoch submission prices
    let resVoteInfo = await ftso.getEpochVotes(epoch);
    testExample.weightRatio = await getWeightRatio(ftso, epoch, resVoteInfo);
    prettyPrintVoteInfo(epoch, resVoteInfo, testExample.weightRatio!, logger);

    // Print results                
    let res = await ftso.getFullEpochReport(epoch);
    prettyPrintEpochResult(epoch, res, resVoteInfo, testExample.weightRatio!, logger);
    let voterRes = toEpochResult(res, resVoteInfo);
    let testCase = {
        example: testExample,
        targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address), undefined, undefined, logger),
        testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
    } as TestCase;

    return testCase;
}

export async function getWeightRatio(ftso: MockFtso, epoch: number, resVoteInfo: { _weightsFlr: BigNumber[]; _weightsAsset: BigNumber[]; }) {
    const sumWeightsFlr = arraySum(resVoteInfo._weightsFlr);
    const sumWeightsAsset = arraySum(resVoteInfo._weightsAsset);
    const weightRatio = await ftso.getWeightRatio(epoch, sumWeightsFlr, sumWeightsAsset);
    return weightRatio.toNumber();
}

export async function submitPrice(signers: readonly SignerWithAddress[], ftso: MockFtso, prices: number[]): Promise<{ epoch: number; }> {
    const len = prices.length;
    let promises = [];
    let epochs: number[] = [];
    for (let i = 0; i < len; i++) {
        let price = prices[i];
        let random = priceToRandom(price);
        let hash = submitPriceHash(price, random, signers[i].address);
        promises.push(waitFinalize(signers[i], async () =>
            ftso.connect(signers[i]).submitPriceHash(hash)
        ));
    }
    (await Promise.all(promises)).forEach(res => {
        epochs.push((res.events![0].args![1] as BigNumber).toNumber());
    });
    let uniqueEpochs: number[] = [...(new Set(epochs))];
    expect(uniqueEpochs.length, `Too short epoch for the test. Increase epochPeriod.`).to.equal(1);

    return { epoch: uniqueEpochs[0] };
}

export async function revealPrice(signers: readonly SignerWithAddress[], ftso: MockFtso, prices: number[], epoch: number) {
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
