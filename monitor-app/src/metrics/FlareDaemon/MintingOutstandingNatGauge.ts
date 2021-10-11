import { Gauge } from "prom-client";
import { ethers } from "ethers";
import { FlareDaemon } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const MINTING_OUTSTANDING_NAT_GAUGE = "flare_daemon_minting_outstanding_nat";

/**
 * @public
 */
export function makeMintingOutstandingNatGauge(flareDaemon: FlareDaemon): Gauge<string> {
  return new Gauge({
    name: MINTING_OUTSTANDING_NAT_GAUGE,
    help: "The expected amount of native token expected to be minted",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: MINTING_OUTSTANDING_NAT_GAUGE});
      try {
        const totalMintingRequestedWei = await flareDaemon.totalMintingRequestedWei();
        const totalMintingReceivedWei = await flareDaemon.totalMintingReceivedWei();
        const mintingOutstandingWei = totalMintingRequestedWei.sub(totalMintingReceivedWei);
        this.set({"address": flareDaemon.address}, Number(ethers.utils.formatEther(mintingOutstandingWei)));
      } catch (e) {
        this.set({"address": flareDaemon.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}