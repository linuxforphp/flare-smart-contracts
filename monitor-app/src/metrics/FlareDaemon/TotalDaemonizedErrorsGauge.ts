import { Gauge } from "prom-client";
import { FlareDaemon } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const TOTAL_DAEMONIZED_ERRORS_GAUGE = "flare_daemon_total_daemonized_errors";
const TOTAL_DAEMONIZED_ERRORS_INDEX = 4;

/**
 * @public
 */
export function makeTotalDaemonizedErrorsGauge(flareDaemon: FlareDaemon): Gauge<string> {
  return new Gauge({
    name: TOTAL_DAEMONIZED_ERRORS_GAUGE,
    help: "The total number of daemonized errors from the last errored block",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: TOTAL_DAEMONIZED_ERRORS_GAUGE});
      try {
        const response = await flareDaemon.showLastDaemonizedError();
        this.set({"address": flareDaemon.address}, response[TOTAL_DAEMONIZED_ERRORS_INDEX].toNumber());
      } catch (e) {
        this.set({"address": flareDaemon.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}