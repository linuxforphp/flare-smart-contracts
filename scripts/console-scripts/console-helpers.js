async function checkSuccess(txHash) {
    let PriceSubmitter = artifacts.require("PriceSubmitter");
    let priceSubmitter = await PriceSubmitter.at("0x1000000000000000000000000000000000000003")
    let tx = await web3.eth.getTransactionReceipt(txHash)
    console.log("Gas:", tx.gasUsed)
    let bn = tx.blockNumber
    // let block = await web3.eth.getBlock(bn)
    let event = (await priceSubmitter.getPastEvents("PricesRevealed", {fromBlock: bn, toBlock: bn})).filter(x => x.transactionHash == txHash)
    return event[0].args.success
}


let FlareKeeper = artifacts.require("FlareKeeper");
let flareKeeper = await FlareKeeper.at("0x8858eeB3DfffA017D4BCE9801D340D36Cf895CCf");
et tx = await flareKeeper.setInflation("0xf784709d2317D872237C4bC22f867d1BAe2913AB")