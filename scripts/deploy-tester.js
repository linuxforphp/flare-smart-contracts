let Tester = artifacts.require("Tester");
let tester = await Tester.new({ gasPrice: "500000000000", gas: "2000000" });
let tx = tester.push(1);


let res2 = await Promise.all([1, 1, 1, 1, 1, 1, 1, 1, 1].map(async () => await Tester.new({ gasPrice: "5000000000000", gas: "2000000" })))

let res = [await Tester.new({ gasPrice: "500000000000", gas: "2000000" })]

let c1 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c2 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c3 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c4 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c5 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c6 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c7 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c8 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let c9 = await Tester.new({ gasPrice: "5000000000000", gas: "2000000" });
let addresses = [c1, c2, c3, c4, c5, c6, c7, c8, c9].map(x => x.address)



[
    "0xEB91ACF73c2A5adaE587dF8a5aBFAE489Fc565e2",
    "0x83816e9366245FE431032FFB5f220b418d8D7288",
    "0xeB4D84400d4e9e31D2F86Ec04Ba1f66F1E83b33a",
    "0x0AcC8aaF718B82ae866bbe703f56501B8AE6512B",
    "0xfa3ec782541E9Be14a9E31c055819780ba4d74AB",
    "0x96e0CdE15143973B2aB902E95bA35b7974deB8ED",
    "0x2F7EDd2Ef7938314D2f6f1b64D7421Dbfe0f9813",
    "0x771053729AD3c6a74246b7cB3c9Ba680bE51d88F",
    "0x75C9949448c1528404393944b0aCDc97Da6b9deb",
    "0x28e3547056d8fc457892172D11913491d7E0D651"
]


let Tester2 = artifacts.require("Tester2");
let tester2 = await Tester2.new(100000, { gasPrice: "500000000000", gas: "2000000" });
let tx = tester.push(1);
await tester.length()


100000
"0x4f6e56dC059eAab6F0De018Bd81F4B1C306ca928"



let tester1000 = await Tester2.new(1000, { gasPrice: "500000000000", gas: "2000000" });
1000
"0x005300F725978FAF02e5B0A4CcB53431c4Abb0Bf"


let Tester2 = artifacts.require("Tester2");
let c0 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c1 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c2 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c3 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c4 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c5 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c6 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c7 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c8 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let c9 = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let addresses = [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9].map(x => x.address)

contracts = await Promise.all([...Array(100).keys()].map(async (x, i) => { console.log(i); l }))


async function generateContracts2(n) {
    let contracts = []
    for (let i = 0; i < n; i++) {
        console.log(i);
        let res = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
        contracts.push(res);
        console.log(i + "Done")
    }
    return contracts;
}

contracts100 = await generateContracts(100)
contracts100.map(x => x.address)

async function checkLengths(contracts) {
    for (let contract of contracts) {
        console.log((await contract.length()).toString())
    }
}


let testerNew = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });

let testerDegraded = await Tester2.at("0xc83f505957dA2Bda8a5e190c13689387616E9768")

let Tester3 = artifacts.require("Tester3");
let tester3 = await Tester3.new({ gasPrice: "5000000000000", gas: "2000000" });

await Promise.all([2, 5, 10, 15, 20, 30, 35, 40, 45, 50].map(async (x) => (await tester3.push(x)).receipt.gasUsed)]


    async function gasUsage6() {
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

contracts.map(x => x.address)


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


async function gasUsage5_4() {
    let weights = [0, 1, 2, 3, 4, 5, 10, 20, 30, 50];
    console.log("{")
    for (let weight of weights) {
        let gas = (await tester5_x.push(weight)).receipt.gasUsed;
        console.log(weight + ":" + Math.round(gas / 1000) + ",");
    }
    console.log("}");
}

async function testIndex1() {
    adrs = [
        "0xD205809AC4D143D3f8D786331eB95933c0846659",
        "0xc9F859161A66015614971711f1Fb88C7fb0319f9",
        "0x6f074c8f2Db3B090AA994518977c854061Fdd40A",
        "0x5DA00BbdaB869114D4085A2884fD4bddC8B88999",
        "0x415cE58243902E29F275198DAb04f8319a8b11EC",
        "0xcffe040b625709C720294ecd2f628e5C4093642a",
        "0xEf4a9220ebA9B72d850d3d6ff372D5D858E013C2",
        "0x5bCfba9A7a35D80Ba93FC820157e4C436804F02A",
        "0xF6cF06E9014f2e38A9297e8f2Fb51385DC985696",
        "0xaCE657afC4bf83a28AFD49001640C9B51eA64cd8"
    ];
    let contracts = await Promise.all(adrs.map(x => Tester5.at(x)));
    for(let contract of contracts) {
        console.log((await contract.index()).toString())
    }

}