// For use with hardhat console
// Run hardhat console with:
// yarn hardhat console --network costonPrivateBeta

// Helper functions

async function generateContracts(factory, n, ...args) {
    let contracts = []
    for (let i = 0; i < n; i++) {
        console.log(i);
        let res = await factory.new(...args, { gasPrice: "5000000000000", gas: "2000000" });
        contracts.push(res);
        console.log(i, "Done")
    }
    return contracts;
}

// Contract has to have push(n) function
async function gasUsage(contract, weights = [0, 1, 2, 3, 4, 5, 10, 20, 30, 50]) {
    console.log("{")
    for (let weight of weights) {
        let gas = (await contract.push(weight)).receipt.gasUsed;
        console.log(weight + ":" + Math.round(gas / 1000) + ",");
    }
    console.log("}");
}


// Tester.sol
let Tester = artifacts.require("Tester");
let tester = await Tester.new({ gasPrice: "500000000000", gas: "2000000" });
let tx = tester.push(1);
let contracts = await generateContracts(Tester, 100)
contracts.map(contract => contract.address)

// Tester2.sol
let Tester2 = artifacts.require("Tester2");
let tester2 = await Tester2.new(100000, { gasPrice: "500000000000", gas: "2000000" });
let tx = tester.push(1);
await tester.length()


contracts2_100 = await generateContracts(Tester2, 100)
contracts2_100.map(x => x.address)

async function checkLengths(contracts) {
    for (let contract of contracts) {
        console.log((await contract.length()).toString())
    }
}


let testerNew = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let testerDegraded = await Tester2.at("0xc83f505957dA2Bda8a5e190c13689387616E9768")

// Tester3.sol

let Tester3 = artifacts.require("Tester3");
let tester3 = await Tester3.new({ gasPrice: "5000000000000", gas: "2000000" });

async function gasUsage3() {
    let weights = [2, 5, 10, 15, 20, 30, 35, 45, 60, 70];
    console.log("{")
    for (let weight of weights) {
        let gas = (await tester3.push(weight)).receipt.gasUsed;
        console.log(weight + ":" + gas + ",");
    }
    console.log("}");
}

async function generateContracts3(n) {
        let contracts = []
        for (let i = 0; i < n; i++) {
            console.log(i);
            let res = await Tester3.new({ gasPrice: "5000000000000", gas: "2000000" });
            contracts.push(res);
            console.log(i + "Done")
        }
        return contracts;
    }

let contracts3 = await generateContracts3(10)
contracts.map(x => x.address)

// Tester4.sol
let Tester4 = artifacts.require("Tester4");
let tester4 = await Tester4.new({ gasPrice: "5000000000000", gas: "2000000" });

async function generateContracts4(n) {
    let contracts = []
    for (let i = 0; i < n; i++) {
        console.log(i);
        let res = await Tester4.new({ gasPrice: "5000000000000", gas: "2000000" });
        contracts.push(res);
        console.log(i + "Done")
    }
    return contracts;
}

let contracts4 = await generateContracts4(10)
let addresses4 = contracts4.map(x => x.address)

// Tester5.sol
let Tester5 = artifacts.require("Tester5");
let tester5 = await Tester5.new(2000000, { gasPrice: "5000000000000", gas: "2000000" });

async function generateContracts5(n, maxLen) {
    let contracts = []
    for (let i = 0; i < n; i++) {
        console.log(i);
        let res = await Tester5.new(maxLen, { gasPrice: "5000000000000", gas: "2000000" });
        contracts.push(res);
        console.log(i + "Done")
    }
    return contracts;
}

let contracts5 = await generateContracts5(10, 2000000)
let contracts5_2 = await generateContracts5(10, 500000)
let addresses5 = contract5.map(contract => contract.address)

