import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Signer } from "ethers";
import { ethers } from "hardhat";

const { time } = require('@openzeppelin/test-helpers');

/**
 * Helper function for instantiating and deploying a contract by using factory.
 * @param name Name of the contract
 * @param signer signer
 * @param args Constructor params
 * @returns deployed contract instance (promise)
 */
export async function newContract<T>(name: string, signer: Signer, ...args: any[]) {
    const factory = await ethers.getContractFactory(name, signer);
    let contractInstance = (await factory.deploy(...args));
    await contractInstance.deployed();
    return contractInstance as unknown as T;
}

/**
 * Auxilliary date formating.
 * @param date 
 * @returns 
 */
export function formatTime(date: Date): string {
    return `${ ('0000' + date.getFullYear()).slice(-4) }-${ ('0' + (date.getMonth() + 1)).slice(-2) }-${ ('0' + date.getDate()).slice(-2) } ${ ('0' + date.getHours()).slice(-2) }:${ ('0' + date.getMinutes()).slice(-2) }:${ ('0' + date.getSeconds()).slice(-2) }`
}

/**
 * Sets parameters for shifting time to future. Note: seems like 
 * no block is mined after this call, but the next mined block has
 * the the timestamp equal time + 1 
 * @param tm 
 */
export async function increaseTimeTo(tm: any, callType: 'ethers' | 'web3' = "ethers") {
    if (process.env.VM_FLARE_TEST == "real") {
        // delay
        while (true) {
            let now = Math.round(Date.now() / 1000);
            if (now > tm) break;
            // console.log(`Waiting: ${time - now}`);
            await new Promise((resolve: any) => setTimeout(() => resolve(), 1000));
        }
        return await advanceBlock();
    } else if (process.env.VM_FLARE_TEST == "shift") {
        // timeshift
        let dt = new Date(0);
        dt.setUTCSeconds(tm);
        let strTime = formatTime(dt);
        const got = require('got');
        let res = await got(`http://localhost:8080/${ strTime }`)
        // console.log("RES", strTime, res.body)
        return await advanceBlock();
    } else {
        // Hardhat
        if (callType == "ethers") {
            await ethers.provider.send("evm_mine", [tm]);
        } else {
            await time.increaseTo(tm);
        }

        // THIS RETURN CAUSES PROBLEMS FOR SOME STRANGE REASON!!!
        // ethers.provider.getBlock stops to work!!!
        // return await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
    }
}

/**
 * Hardhat wrapper for use with web3/truffle
 * @param tm 
 * @param advanceBlock 
 * @returns 
 */
export async function increaseTimeTo3(tm: any, advanceBlock: () => Promise<FlareBlock>) {
    return increaseTimeTo(tm, "web3")
}

/**
 * Finalization wrapper for ethers. Needed on Flare network since account nonce has to increase
 * to have the transaction confirmed.
 * @param address 
 * @param func 
 * @returns 
 */
export async function waitFinalize(signer: SignerWithAddress, func: () => any) {
    let nonce = await ethers.provider.getTransactionCount(signer.address);
    let res = await (await func()).wait();
    while ((await ethers.provider.getTransactionCount(signer.address)) == nonce) {
        await new Promise((resolve: any) => { setTimeout(() => { resolve() }, 100) })
        // console.log("Delaying")
    }
    return res;
}

/**
 * Finalization wrapper for web3/truffle. Needed on Flare network since account nonce has to increase
 * to have the transaction confirmed.
 * @param address 
 * @param func 
 * @returns 
 */
export async function waitFinalize3(address: string, func: () => any) {
    let nonce = await web3.eth.getTransactionCount(address);
    let res = await func();
    while ((await web3.eth.getTransactionCount(address)) == nonce) {
        await new Promise((resolve: any) => { setTimeout(() => { resolve() }, 100) })
        console.log("Waiting...")
    }
    return res;
}

// Copied from Ethers library as types seem to not be exported properly
interface _Block {
    hash: string;
    parentHash: string;
    number: number;

    timestamp: number;
    nonce: string;
    difficulty: number;

    gasLimit: BigNumber;
    gasUsed: BigNumber;

    miner: string;
    extraData: string;
}

export interface FlareBlock extends _Block {
    transactions: Array<string>;
}

/**
 * Artificial advance block making simple transaction and mining the block
 * @returns Returns data about the mined block
 */
export async function advanceBlock(): Promise<FlareBlock> {
    let signers = await ethers.getSigners();
    await waitFinalize(signers[0], () => signers[0].sendTransaction({
        to: signers[1].address,
        // value: ethers.utils.parseUnits("1", "wei"),
        value: 0,
        data: ethers.utils.hexlify([1])
    }));
    let blockInfo = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
    return blockInfo;
    // // console.log(`MINE BEAT: ${ blockInfo.timestamp - blockInfoStart.timestamp}`)
}

/**
 * Helper wrapper to convert number to BN 
 * @param n 
 * @returns 
 */
export function toBN(n: number | string) {
    return web3.utils.toBN(n);
}

export function numberedKeyedObjectToList<T>(obj: any) {
    let lst: any[] = []
    for (let i = 0; ; i++) {
        if (i in obj) {
            lst.push(obj[i])
        } else {
            break;
        }
    }
    return lst as T[];
}

export function doBNListsMatch(lst1: BN[], lst2: BN[]) {
    if (lst1.length != lst2.length) return false;
    for (let i = 0; i < lst1.length; i++) {
        if (!lst1[i].eq(lst2[i])) return false;
    }
    return true;
}

export function lastOf(lst: any[]) {
    return lst[lst.length-1];
}

export function compareNumberArrays(a: BN[], b: number[]) {
    expect(a.length, `Expected array length ${a.length} to equal ${b.length}`).to.equals(b.length);
    for (let i = 0; i < a.length; i++) {
        expect(a[i].toNumber(), `Expected ${a[i].toNumber()} to equal ${b[i]} at index ${i}`).to.equals(b[i]);
    }
}

export function compareArrays<T>(a: T[], b: T[]) {
    expect(a.length, `Expected array length ${a.length} to equal ${b.length}`).to.equals(b.length);
    for (let i = 0; i < a.length; i++) {
        expect(a[i], `Expected ${a[i]} to equal ${b[i]} at index ${i}`).to.equals(b[i]);
    }
}

export function submitPriceHash(price: number | BN | BigNumber, random: number | BN | BigNumber): string {
    return ethers.utils.solidityKeccak256([ "uint256", "uint256" ], [ price.toString(), random.toString() ]);
}
