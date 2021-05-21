import { 
  FlareKeeperInstance
} from "../../typechain-truffle";

const BN = web3.utils.toBN;

/**
 * Print all errors that have occurred.
 * @param flareKeeper - The keeer contract
 * @param fromBlockNumber - Beginning block number to iterate over
 * @param toBlockNumber - Ending block number to iterate over
 * @dev Blocks are iterated over sequentially, whether they exist or not.
 */
 export async function spewKeeperErrors(flareKeeper: FlareKeeperInstance, fromBlockNumber: BN, toBlockNumber: BN): Promise<number> {
  let count: number = 0;
  for(
    let currentBlockNumber = fromBlockNumber; 
    currentBlockNumber.lte(toBlockNumber); 
    currentBlockNumber = currentBlockNumber.add(BN(1))) {
    var i = 0;
    while(true) {
      try {
        const error = await flareKeeper.errorsByBlock(currentBlockNumber, i);
        if (error[1] != "") {
          console.log(`Keeper error detected; block = ${currentBlockNumber}; contract address = ${error[0]}; message = ${error[1]}`);
          count += 1;
        }
        i++;
      } catch (e) {
        // Ignore, move on
        break;
      }
    }
  }
  return count;
}