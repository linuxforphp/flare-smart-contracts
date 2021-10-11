import { BaseProvider } from "@ethersproject/providers";
import { Signer } from "ethers";
import { FlareDaemon__factory, 
  FtsoRewardManager__factory, 
  Inflation__factory } from "../typechain";
import { Contracts } from "../../deployment/scripts/Contracts";
import * as metrics from "./metrics";

/**
 * @public
 */
export function addMetrics(provider: BaseProvider, contracts: Contracts, signer: Signer) {
  // Wire up all the contracts needed
  const flareDaemonFactory = new FlareDaemon__factory(signer); 
  const flareDaemon = flareDaemonFactory.attach(contracts.getContractAddress(Contracts.FLARE_DAEMON));
  const inflationFactory = new Inflation__factory(signer); 
  const inflation = inflationFactory.attach(contracts.getContractAddress(Contracts.INFLATION));
  const ftsoRewardManagerFactory = new FtsoRewardManager__factory(signer); 
  const ftsoRewardManager = ftsoRewardManagerFactory.attach(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));

  // Make the metrics
  metrics.makeBlockHoldoffsRemainingGauge(flareDaemon);
  metrics.makeBlockNumberGauge(provider);
  metrics.makeBlockNumberTsGauge(provider);
  metrics.makeCurrentAnnumEndTimeStampGauge(inflation);
  metrics.makeCurrentBalanceNatGauge(inflation, "inflation");
  metrics.makeCurrentBalanceNatGauge(ftsoRewardManager, "ftso_reward_manager");
  metrics.makeLastAuthorizationTsGauge(inflation);
  metrics.makeMintingOutstandingNatGauge(flareDaemon);
  metrics.makeRewardEpochStartTsGauge(inflation);
  metrics.makeSystemLastTriggeredAtGauge(flareDaemon);
  metrics.makeSystemLastTriggeredAtTsGauge(flareDaemon);
  metrics.makeTotalDaemonizedErrorsGauge(flareDaemon);
  metrics.makeTotalUnclaimedAwardsOutstandingNatGauge(ftsoRewardManager);
  metrics.makeMetricResponseTimeHistogram();
  metrics.makeTransactionCountGauge(flareDaemon, "flare_daemon");
  metrics.makeTransactionCountGauge(inflation, "inflation");
  metrics.makeTransactionCountGauge(ftsoRewardManager, "ftso_reward_manager");
}
