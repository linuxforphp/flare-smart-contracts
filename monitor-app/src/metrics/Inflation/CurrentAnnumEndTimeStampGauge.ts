import { Gauge } from "prom-client";
import { Inflation } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const CURRENT_ANNUM_END_TIME_STAMP_GAUGE = "inflation_current_annum_end_time_stamp";
/**
 * @public
 */
export function makeCurrentAnnumEndTimeStampGauge(inflation: Inflation): Gauge<string> {
  return new Gauge({
    name: CURRENT_ANNUM_END_TIME_STAMP_GAUGE,
    help: "The end timestamp of the current inflation annum",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: CURRENT_ANNUM_END_TIME_STAMP_GAUGE});
      try {
        const currentAnnum = await inflation.getCurrentAnnum();
        const endTimeStamp = currentAnnum[3];
        this.set({"address": inflation.address}, endTimeStamp.toNumber());
      } catch(e) {
        this.set({"address": inflation.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}