import { Gauge } from "prom-client";
import { BaseContract, ethers } from "ethers";
const camelCase = require('camelcase');
import { getMetricResponseTimeHistogram } from "./MetricResponseTimeHistogram";

/**
 * @public
 */
export function makeTransactionCountGauge(baseContract: BaseContract, namePrefix: string): Gauge<string> {
  const TRANSACTION_COUNT_GAUGE = `${namePrefix}_transaction_count`;

  return new Gauge({
    name: TRANSACTION_COUNT_GAUGE,
    help: `The transaction count of the ${camelCase(namePrefix, {pascalCase: true})} contract`,
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: TRANSACTION_COUNT_GAUGE});
      try {
        // The number of transactions sent as of the block tag earliest...which will indicate if tx deployed.
        const txCount = await baseContract.provider.getTransactionCount(baseContract.address, "earliest");
        this.set({"address": baseContract.address}, txCount);
      } catch (e) {
        this.set({"address": baseContract.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}

