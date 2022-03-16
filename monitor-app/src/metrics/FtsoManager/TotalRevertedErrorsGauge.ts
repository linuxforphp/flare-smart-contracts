import { Gauge } from "prom-client";
import { FtsoManager } from "../../../typechain";
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const TOTAL_REVERTED_ERRORS_GAUGE = "ftso_manager_total_reverted_errors_gauge";
/**
 * @public
 */
export function makeTotalRevertedErrorsGauge(ftsoManager: FtsoManager): Gauge<string> {
  return new Gauge({
    name: TOTAL_REVERTED_ERRORS_GAUGE,
    help: "FtsoManager total reverted errors",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: TOTAL_REVERTED_ERRORS_GAUGE});
      try {
        const totalRevertedErrors = (await ftsoManager.errorData()).totalRevertedErrors;
        this.set({"address": ftsoManager.address}, totalRevertedErrors.toNumber());
      } catch (e) {
        this.set({"address": ftsoManager.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}