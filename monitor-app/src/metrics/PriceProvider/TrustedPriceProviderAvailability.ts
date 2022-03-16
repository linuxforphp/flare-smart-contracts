import { Gauge } from "prom-client";
import { PriceSubmitter, FtsoRegistry } from "../../../typechain";
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";
import axios from "axios";

const TRUSTED_PRICE_PROVIDER_AVAILABILITY_GAUGE = "trusted_price_provider_availability";
/**
 * @public
 */
export function makeTrustedPriceProviderAvailabilityGauge(priceSubmitter: PriceSubmitter, ftsoRegistry: FtsoRegistry, ftsoMonitorApiUrl: string): Gauge<string> {
  return new Gauge({
    name: TRUSTED_PRICE_PROVIDER_AVAILABILITY_GAUGE,
    help: "Number of price epochs that each trusted price provider was available in last 3 hours",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: TRUSTED_PRICE_PROVIDER_AVAILABILITY_GAUGE});
      try {
        const priceProviders = await priceSubmitter.getTrustedAddresses();
        const allFtsos = await ftsoRegistry.getAllFtsos();
        const { data } = await axios.get(ftsoMonitorApiUrl + 'auth/ftso/count-votes');
        
        for (const address of priceProviders) {
          const availableEpochs = data.data[address] / allFtsos.length;
          this.set({"address": address}, availableEpochs);
        }
      } catch (e) {
        this.set({"address": "none"}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}