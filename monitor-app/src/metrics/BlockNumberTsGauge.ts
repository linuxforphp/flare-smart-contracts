import { BaseProvider } from "@ethersproject/providers";
import { Gauge } from "prom-client"; 
import { getMetricResponseTimeHistogram } from "./MetricResponseTimeHistogram";

const BLOCK_NUMBER_TS_GAUGE = "block_number_ts";

/**
 * @public
 */
export function makeBlockNumberTsGauge(provider: BaseProvider): Gauge<string> {
  return new Gauge({
    name: BLOCK_NUMBER_TS_GAUGE,
    help: "The chain's last block number timestamp",
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: BLOCK_NUMBER_TS_GAUGE});
      try {
        const block = await provider.getBlock("latest");
        this.set(block.timestamp);
      } catch (e) {
        this.set(0);
      } finally {
        stopTimer();
      }
    }
  });
}