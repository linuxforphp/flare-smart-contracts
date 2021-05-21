import { increaseTimeTo } from "./test-helpers";

/**
 * @notice Helper function to time travel to inter minting time interval prior to inflation reward topup withdrawl.
 * @param lastFundsWithdrawTs - last timestamp funds were withdrawn
 * @param fundWithdrawTimeLockSec - minimum time in seconds that must pass before another topup can occur
 * @param fundRequestIntervalSec - max time in seconds, prior to next topup, minting can be requested
 */
 export async function moveToInterMintingStart(
   lastFundsWithdrawTs: number, 
   fundWithdrawTimeLockSec: number, 
   fundRequestIntervalSec: number) {
  const interMintingStartTimestamp = lastFundsWithdrawTs + fundWithdrawTimeLockSec - fundRequestIntervalSec + 1;
  return await increaseTimeTo(interMintingStartTimestamp);
}

/**
 * @notice Helper function to time travel to move to next reward topup withdrawl interval.
 * @param lastFundsWithdrawTs - last timestamp funds were withdrawn
 * @param fundWithdrawTimeLockSec - minimum time in seconds that must pass before another topup can occur
 */
 export async function moveToNextFundWithdrawStart(
  lastFundsWithdrawTs: number, 
  fundWithdrawTimeLockSec: number) {
 const nexFundWithdrawTimestamp = lastFundsWithdrawTs + fundWithdrawTimeLockSec + 1;
 return await increaseTimeTo(nexFundWithdrawTimestamp);
}
