import { Gauge } from "prom-client";
import { FlareDaemon } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const BLOCK_HOLDOFFS_REMAINING_GAUGE = "flare_daemon_block_holdoffs_remaining";

/**
 * @public
 */
export function makeBlockHoldoffsRemainingGauge(flareDaemon: FlareDaemon): Gauge<string> {
  return new Gauge({
    name: BLOCK_HOLDOFFS_REMAINING_GAUGE,
    help: "The number of block holdoffs remaining",
    labelNames: ["flare_daemon_address", "daemonized_contract_address"],
    async collect() {
      var index = 0;
      for(;;) {
        const metricResponseTime = getMetricResponseTimeHistogram();
        const stopTimer = metricResponseTime.startTimer({ metric: BLOCK_HOLDOFFS_REMAINING_GAUGE});
        try {
          const daemonizedContractsData = await flareDaemon.getDaemonizedContractsData();
          const daemonizedContractAddress = await daemonizedContractsData[0][index];
          const blockHoldoffRemaining = await daemonizedContractsData[2][index];
          this.set(
            {"flare_daemon_address": flareDaemon.address, 
            "daemonized_contract_address": daemonizedContractAddress}, 
            blockHoldoffRemaining.toNumber()
          );
          index++;
        } catch (e) {
          // Because revert reason text is not predictable, just assume we are done.
          // We must do these gyrations because we are not exposing getters for array lengths.
          // It would be better 
          break;
        } finally {
          stopTimer();
        }
      }
    }
  });
}