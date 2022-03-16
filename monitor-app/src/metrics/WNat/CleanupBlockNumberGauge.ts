import { Gauge } from "prom-client";
import { WNat } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const CLEANUP_BLOCK_NUMBER_GAUGE = "wnat_cleanup_block_number";
/**
 * @public
 */
export function makeCleanupBlockNumberGauge(wNat: WNat): Gauge<string> {
  return new Gauge({
    name: CLEANUP_BLOCK_NUMBER_GAUGE,
    help: "WNat cleanup block number",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: CLEANUP_BLOCK_NUMBER_GAUGE});
      try {
        const cleanupBlockNumber = await wNat.cleanupBlockNumber();
        this.set({"address": wNat.address}, cleanupBlockNumber.toNumber());
      } catch (e) {
        this.set({"address": wNat.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}