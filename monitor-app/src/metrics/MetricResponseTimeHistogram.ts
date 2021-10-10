import { Histogram, register } from "prom-client";

const METRIC_RESPONSE_TIME_HISTOGRAM = "monitor_app_metric_response_time_seconds";

export function makeMetricResponseTimeHistogram(): Histogram<string> {
  return new Histogram({
    name: METRIC_RESPONSE_TIME_HISTOGRAM,
    help: 'Histogram of metric collection response time in seconds',
    labelNames: ['metric']
  });  
} 

export function getMetricResponseTimeHistogram(): Histogram<string> {
  const metric = register.getSingleMetric(METRIC_RESPONSE_TIME_HISTOGRAM) as Histogram<string>;
  if (metric !== undefined) {
    return metric;
  } else {
    return makeMetricResponseTimeHistogram();
  }
}