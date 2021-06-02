import { 
  FlareKeeperInstance
} from "../../typechain-truffle";

const BN = web3.utils.toBN;

/**
 * Print all errors that have occurred.
 * @param flareKeeper - The keeer contract
 */
 export async function spewKeeperErrors(flareKeeper: FlareKeeperInstance): Promise<number> {
  let count: number = 0;
  const errorData = await flareKeeper.showKeptErrors(0, 100);
  for (let i = 0; i < 100; i++) {
    try {
      if (errorData[2][i] !== undefined) {
        console.log(`Keeper error detected; last block = ${errorData[0][i]}; contract address = ${errorData[3][i]}; message = ${errorData[2][i]}; count = ${errorData[1][i]}`);
      }
    } catch (e) {
      // Ignore, move on
      break;
    }
  }
  return errorData[4].toNumber();
}
