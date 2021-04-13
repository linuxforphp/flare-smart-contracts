import { ethers } from "ethers";

// TODO: simple SC deployments using ethers.
async function deployContracts() {
    const fs = require('fs');
    // const Wallet = require('ethereumjs-wallet').default;

    let privateKey = "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122";

    // let wallet = new Wallet(Buffer.from(privateKey.slice(2), "hex"));
    // let rpcLink = "https://coston.flare.network/ext/bc/C/rpc";
    let rpcLink = "http://127.0.0.1:9650/ext/bc/C/rpc";
    const provider = new ethers.providers.JsonRpcProvider(rpcLink);
    
    let wallet = new ethers.Wallet(privateKey, provider);
    // ethers.getSigner()    
    // console.log(await provider.getBlockNumber());
    // // const signer = provider.getSigner()
    // // console.log(signer)

    // // let signers = await ethers.getSigners();

    // // let flrToken = await newContract<MockVPToken>("MockVPToken", signers[0],
    // //     signers.slice(0, len).map(signer => signer.address), testExample.weightsFlr
    // // )

    // let len = 3;
    // ethers.ContractFactory.fromSolidity('artifacts/contracts/implementations/')
    // const factory = await ethers.getContractFactory("MockVPToken", signers[0]);
    // let contractInstance = (await factory.deploy(signers.slice(0, len).map(signer => signer.address), [1,2,3]));
    // await contractInstance.deployed();

    // let contract = new ethers.Contract(wallet.address, abi, wallet);
}

deployContracts();
