import { Gauge } from "prom-client";
import { BaseContract, ethers } from "ethers";
const camelCase = require('camelcase');
import { getMetricResponseTimeHistogram } from "./MetricResponseTimeHistogram";

/**
 * @public
 */
export function makeCurrentBalanceNatGauge(baseContract: BaseContract, namePrefix: string): Gauge<string> {
  const CURRENT_BALANCE_NAT_GAUGE = `${namePrefix}_current_balance_nat`;

  return new Gauge({
    name: CURRENT_BALANCE_NAT_GAUGE,
    help: `The current balance of the ${camelCase(namePrefix, {pascalCase: true})} contract in native token units`,
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: CURRENT_BALANCE_NAT_GAUGE});
      try {
        const currentBalanceWei = await baseContract.provider.getBalance(baseContract.address);
        this.set({"address": baseContract.address}, Number(ethers.utils.formatEther(currentBalanceWei)));
      } catch (e) {
        this.set({"address": baseContract.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}