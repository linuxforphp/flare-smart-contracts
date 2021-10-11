import { Gauge } from "prom-client";
import { Inflation } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const LAST_AUTHORIZATION_TS_GAUGE = "inflation_last_authorization_ts";

/**
 * @public
 */
export function makeLastAuthorizationTsGauge(inflation: Inflation): Gauge<string> {
  return new Gauge({
    name: LAST_AUTHORIZATION_TS_GAUGE,
    help: "The timestamp of the last inflation authorization",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: LAST_AUTHORIZATION_TS_GAUGE});
      try {
        const lastAuthorizationTs = await inflation.lastAuthorizationTs();
        this.set({"address": inflation.address}, lastAuthorizationTs.toNumber());
      } catch (e) {
        this.set({"address": inflation.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}