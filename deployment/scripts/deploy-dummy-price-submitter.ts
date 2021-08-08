/**
 * This script will deploy all contracts for the DummyPriceSubmitter.
 * It will output the address of deployed PriceSubmitter.
 */


 import {
    DummyPriceSubmitterInstance
  } from "../../typechain-truffle";


 
 async function main() {
  const PriceSubmitter = artifacts.require("DummyPriceSubmitter");
  const priceSubmitter: DummyPriceSubmitterInstance = await PriceSubmitter.new() 
  console.log("PriceSubmitter address:", await priceSubmitter.address);
 }
 
 main()
   .then(() => process.exit(0))
   .catch(error => {
     console.error(error);
     process.exit(1);
   });
 