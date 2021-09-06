////////////////////////////////////////////////////////
/// This file contains functions and code examples, that can be used
/// when using `yarn hardhat console --network some_network`
/// NOTE: Javascript is used in console, not Typescript
/// Examples can be pasted to console.
/// First example can be run on local netwokr. In one terminal run:
/// yarn hardhat node
/// and then in other terminal run
/// yarn hardhat console --network local
////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////
// Example 1: Deploy dummy token contract and do some money transfer 
///////////////////////////////////////////////////////////////
//Deploy contract to new address
let DummyVPToken = artifacts.require("DummyVPToken");
let dummyVPToken = await DummyVPToken.new("Dummy Vote Power Token", "DVPT");
console.log(dummyVPToken.address)
// TODO: try to find other way to get direct account addresses through truffle, without using ethers
let signers = await ethers.getSigners() 
let accounts = signers.map(signer => signer.address)

// Do some wiring
(await dummyVPToken.balanceOf(accounts[0])).toString()
(await dummyVPToken.balanceOf(accounts[1])).toString()
let tx1 = await dummyVPToken.approve(accounts[1], web3.utils.toWei("1", "ether"))
let tx2 = await dummyVPToken.transfer(accounts[1], web3.utils.toWei("1", "ether"))
(await dummyVPToken.balanceOf(accounts[0])).toString()
(await dummyVPToken.balanceOf(accounts[1])).toString()
let tx3 = await dummyVPToken.approve(accounts[2], web3.utils.toWei("1", "ether"), {from: accounts[1]})
let tx4 = await dummyVPToken.transfer(accounts[2], web3.utils.toWei("1", "ether"), {from: accounts[1]})
(await dummyVPToken.balanceOf(accounts[1])).toString()
(await dummyVPToken.balanceOf(accounts[2])).toString()

///////////////////////////////////////////////////////////////
// Example 2: Code snippet to connect to flare daemon contract on `scdev` or `staging` chains
// and get the governance address 
///////////////////////////////////////////////////////////////
let FlareDaemon = artifacts.require("FlareDaemon");
let flareDaemon = await FlareDaemon.at("0x1000000000000000000000000000000000000002");
await flareDaemon.governance()


///////////////////////////////////////////////////////////////
// Useful code
///////////////////////////////////////////////////////////////

/**
 * Get success parameter from PricesRevealed event given a reveal transaction to PriceSubmitter contract.
 * Default address for genesis PriceSubmitter contract is set as default.
 * @returns 
 */
 async function checkSuccess(txHash, priceSubmitterAddress="0x1000000000000000000000000000000000000003") {
    let PriceSubmitter = artifacts.require("PriceSubmitter");
    let priceSubmitter = await PriceSubmitter.at(priceSubmitterAddress)
    let tx = await web3.eth.getTransactionReceipt(txHash)
    console.log("Gas:", tx.gasUsed)
    let bn = tx.blockNumber
    // let block = await web3.eth.getBlock(bn)
    let event = (await priceSubmitter.getPastEvents("PricesRevealed", {fromBlock: bn, toBlock: bn})).filter(x => x.transactionHash == txHash)
    return event[0].args.success
}
