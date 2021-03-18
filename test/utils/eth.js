/**
 * @description Calc gas cost of a eth transaction.
 * @param {*} result Eth transaction result 
 */
var calcGasCost = async (result) => {
  // Get the transaction
  let tr = await web3.eth.getTransaction(result.tx);
  // Compute the gas cost of the depositResult
  let txCost = web3.utils.toBN(result.receipt.gasUsed).mul(web3.utils.toBN(tr.gasPrice));
  return txCost;
};

var sumGas = (tx, sum) => {
  sum.gas += tx.receipt.gasUsed;
}

Object.assign(exports, {
  calcGasCost,
  sumGas
});