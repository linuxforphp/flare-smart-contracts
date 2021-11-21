////////////////////////////////////////////////////////
/// This file contains functions that can be used
/// when using `yarn hardhat console --network some_network`
/// NOTE: Javascript is used in console, not Typescript, but
/// functions are added to hardhat environment as 
/// Typescript methods using require
////////////////////////////////////////////////////////

/**
 * Get success parameter from PricesRevealed event given a reveal transaction to PriceSubmitter contract.
 * Default address for genesis PriceSubmitter contract is set as default.
 * @returns 
 */
 export async function checkSuccess(txHash: string, priceSubmitterAddress="0x1000000000000000000000000000000000000003") {
    let PriceSubmitter = artifacts.require("PriceSubmitter");
    let priceSubmitter = await PriceSubmitter.at(priceSubmitterAddress)
    let tx = await web3.eth.getTransactionReceipt(txHash)
    console.log("Gas:", tx.gasUsed)
    let bn = tx.blockNumber
    // let block = await web3.eth.getBlock(bn)
    let event = (await priceSubmitter.getPastEvents("PricesRevealed", {fromBlock: bn, toBlock: bn})).filter(x => x.transactionHash == txHash)
    return (event[0] as any).args.success
}
