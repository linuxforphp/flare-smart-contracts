import { Gauge } from "prom-client";
import { PriceSubmitter } from "../../../typechain";
import { ethers } from "ethers";
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const TRUSTED_PRICE_PROVIDER_BALANCE_GAUGE = "trusted_price_provider_balance";
/**
 * @public
 */
export function makeTrustedPriceProviderBalanceGauge(priceSubmitter: PriceSubmitter): Gauge<string> {
  return new Gauge({
    name: TRUSTED_PRICE_PROVIDER_BALANCE_GAUGE,
    help: "Balance of each trusted price provider address",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: TRUSTED_PRICE_PROVIDER_BALANCE_GAUGE});
      try {
        const priceProviders = await priceSubmitter.getTrustedAddresses();
        for (const address of priceProviders) {
          const balanceWei = await priceSubmitter.provider.getBalance(address);
          this.set({"address": address}, Number(ethers.utils.formatEther(balanceWei)));
        }
      } catch (e) {
        this.set({"address": "none"}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}