// Here we should add certain verifications of parameters
export function verifyParameters(parameters: any) {
  // Inflation receivers
  if (!parameters.inflationReceivers) throw Error(`"inflationReceivers" parameter missing`);
  if (!parameters.inflationSharingBIPS) throw Error(`"inflationSharingBIPS" parameter missing`);
  if (!parameters.inflationTopUpTypes) throw Error(`"inflationTopUpTypes" parameter missing`);
  if (!parameters.inflationTopUpFactorsx100) throw Error(`"inflationTopUpFactorsx100" parameter missing`);

  if (new Set([
    parameters.inflationReceivers.length,
    parameters.inflationSharingBIPS.length,
    parameters.inflationTopUpTypes.length,
    parameters.inflationTopUpFactorsx100.length
  ]).size > 1) {
    throw Error(`Parameters "inflationReceivers", "inflationSharingBIPS", "inflationTopUpTypes" and "inflationTopUpFactorsx100" should be of the same size`)
  }

  // Reward epoch duration should be multiple >1 of price epoch
  if (
    parameters.rewardEpochDurationSeconds % parameters.priceEpochDurationSeconds != 0 ||
    parameters.rewardEpochDurationSeconds / parameters.priceEpochDurationSeconds == 1
  ) {
    throw Error(`"rewardEpochDurationSeconds" should be a multiple >1 of "priceEpochDurationSeconds"`)
  }

  // FtsoRewardManager must be inflation receiver
  if (parameters.inflationReceivers.indexOf("FtsoRewardManager") < 0) {
    throw Error(`FtsoRewardManager must be in "inflationReceivers"`)
  }
}
