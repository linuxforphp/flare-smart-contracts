import { Gauge } from "prom-client";
import { WNat } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const TOTAL_VOTE_POWER_TO_BALANCE_DIFFERENCE_GAUGE = "wnat_total_vote_power_to_balance_difference";
/**
 * @public
 */
export function makeTotalVotePowerToBalanceDifferenceGauge(wNat: WNat): Gauge<string> {
  return new Gauge({
    name: TOTAL_VOTE_POWER_TO_BALANCE_DIFFERENCE_GAUGE,
    help: "The difference between WNat balance and total vote power",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: TOTAL_VOTE_POWER_TO_BALANCE_DIFFERENCE_GAUGE});
      try {
        const totalVotePower = await wNat.totalVotePower();
        const wNatBalance = await wNat.provider.getBalance(wNat.address);
        this.set({"address": wNat.address}, wNatBalance.sub(totalVotePower).toNumber());
      } catch (e) {
        this.set({"address": wNat.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}