import { BaseProvider } from "@ethersproject/providers";
import { Gauge } from "prom-client"; 
import { getMetricResponseTimeHistogram } from "./MetricResponseTimeHistogram";

const BLOCK_NUMBER_GAUGE = "block_number";

/**
 * @public
 */
export function makeBlockNumberGauge(provider: BaseProvider): Gauge<string> {
  return new Gauge({
    name: BLOCK_NUMBER_GAUGE,
    help: "The chain's last block number",
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: BLOCK_NUMBER_GAUGE});
      try {
        this.set((await provider.getBlockNumber()).valueOf());
      } catch (e) {
        console.log(e);
        this.set(0);
      } finally {
        stopTimer();
      }
    }
  });
}