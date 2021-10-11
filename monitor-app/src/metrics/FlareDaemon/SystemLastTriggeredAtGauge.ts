import { Gauge } from "prom-client";
import { FlareDaemon } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const SYSTEM_LAST_TRIGGERED_AT_GAUGE = "flare_daemon_system_last_triggered_at";
/**
 * @public
 */
export function makeSystemLastTriggeredAtGauge(flareDaemon: FlareDaemon): Gauge<string> {
  return new Gauge({
    name: SYSTEM_LAST_TRIGGERED_AT_GAUGE,
    help: "The last block executed by the trigger method of the FlareDaemon",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: SYSTEM_LAST_TRIGGERED_AT_GAUGE});
      try {
        const systemLastTriggeredAt = await flareDaemon.systemLastTriggeredAt();
        // TODO: Deal with down conversion
        this.set({"address": flareDaemon.address}, systemLastTriggeredAt.toNumber());
      } catch (e) {
        this.set({"address": flareDaemon.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}