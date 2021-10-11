import { Gauge } from "prom-client";
import { Inflation } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const REWARD_EPOCH_START_TS_GAUGE = "inflation_reward_epoch_start_ts";

/**
 * @public
 */
export function makeRewardEpochStartTsGauge(inflation: Inflation): Gauge<string> {
  return new Gauge({
    name: REWARD_EPOCH_START_TS_GAUGE,
    help: "The timestamp of the first reward epoch that is to begin inflation authorization",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: REWARD_EPOCH_START_TS_GAUGE});
      try {
        const rewardEpochStartTs = await inflation.rewardEpochStartTs();
        this.set({"address": inflation.address}, rewardEpochStartTs.toNumber());
      } catch (e) {
        this.set({"address": inflation.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}