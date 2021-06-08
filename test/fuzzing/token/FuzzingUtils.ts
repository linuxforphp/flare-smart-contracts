import { writeFileSync, readFileSync } from "fs";
import BN from "bn.js";

export type Nullable<T> = T | null | undefined;

export const BN_ZERO = new BN(0);

export const MAX_BIPS = new BN(10_000);

export function toBN(x: BN | number | string) {
    return typeof x === 'object' ? x : web3.utils.toBN(x);
}

export function jsonBNserializer(this: any, key: any, serializedValue: any) {
    const value = this[key];
    return BN.isBN(value) ? value.toString(10) : serializedValue;
}

export function jsonBNDeserializer(bnKeys: string[]) {
    return function (key: any, value: any) {
        return bnKeys.includes(key) ? toBN(value) : value;
    }
}

export function saveJson(file: string, data: any, indent?: string | number) {
    writeFileSync(file, JSON.stringify(data, jsonBNserializer, indent));
}

export function loadJson(file: string, bnKeys: string[] = []) {
    const buf = readFileSync(file);
    return JSON.parse(buf.toString(), jsonBNDeserializer(bnKeys));
}

// start is inclusive, end is exclusive
export function randomInt(end: number): number;
export function randomInt(start: number, end: number): number;
export function randomInt(startOrEnd: number, endOpt?: number): number {
    const [start, end] = endOpt !== undefined ? [startOrEnd, endOpt] : [0, startOrEnd];
    return Math.floor(start + Math.random() * (end - start));
}

// random must return random number on interval [0, 1)
export function randomIntDist(start: number, end: number, random: () => number): number {
    return Math.floor(start + random() * (end - start));
}

// retrun random in [0, 1) with probability density falling linearly from 1 to 0
export function linearFallingRandom() {
    return Math.abs(Math.random() + Math.random() - 1);
}

// (unfair) coin flip - returns true with probability p
export function coinFlip(p: number = 0.5) {
    return Math.random() < p;
}

export function randomChoice<T>(choices: readonly T[]): T {
    if (choices.length === 0) throw new Error("Random choice from empty array.")
    return choices[randomInt(choices.length)];
}

export function weightedRandomChoice<T>(choices: readonly (readonly [T, number])[]): T {
    if (choices.length === 0) throw new Error("Random choice from empty array.")
    let total = 0;
    for (const [choice, weight] of choices) total += weight;
    const rnd = Math.random() * total;
    let cumulative = 0;
    for (const [choice, weight] of choices) {
        cumulative += weight;
        if (rnd < cumulative) return choice;
    }
    return choices[choices.length - 1][0]; // shouldn't arrive here, but just in case...
}

