import { Gauge } from "prom-client";
import { FlareDaemon } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const SYSTEM_LAST_TRIGGERED_AT_TS_GAUGE = "flare_daemon_system_last_triggered_at_ts";

/**
 * @public
 */
export function makeSystemLastTriggeredAtTsGauge(flareDaemon: FlareDaemon): Gauge<string> {
  return new Gauge({
    name: SYSTEM_LAST_TRIGGERED_AT_TS_GAUGE,
    help: "The timestamp of the last block executed by the trigger method of the FlareDaemon",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: SYSTEM_LAST_TRIGGERED_AT_TS_GAUGE});
      try {
        const systemLastTriggeredAt = await flareDaemon.systemLastTriggeredAt();
        const block = await flareDaemon.provider.getBlock(systemLastTriggeredAt.toHexString());
        this.set({"address": flareDaemon.address}, block.timestamp);
      } catch (e) {
        this.set({"address": flareDaemon.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}