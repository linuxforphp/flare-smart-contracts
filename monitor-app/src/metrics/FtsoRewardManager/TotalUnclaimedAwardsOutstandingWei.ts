import { Gauge } from "prom-client";
import { FtsoRewardManager } from "../../../typechain"
import { ethers } from "ethers";
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const TOTAL_UNCLAIMED_AWARDS_OUTSTANDING_NAT_GAUGE = "ftso_reward_manager_total_unclaimed_awards_outstanding_nat";

/**
 * @public
 */
export function makeTotalUnclaimedAwardsOutstandingNatGauge(ftsoRewardManager: FtsoRewardManager): Gauge<string> {
  return new Gauge({
    name: TOTAL_UNCLAIMED_AWARDS_OUTSTANDING_NAT_GAUGE,
    help: "The total amount of unclaimed ftso awards in native token units",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: TOTAL_UNCLAIMED_AWARDS_OUTSTANDING_NAT_GAUGE});
      try {
        const { 0: totalAwardedWei, 1: totalClaimedWei, 2: totalExpiredWei } = await ftsoRewardManager.getTotals();
        const totalUnclaimedAwardsOutstandingWei = totalAwardedWei.sub(totalClaimedWei).sub(totalExpiredWei);
        this.set({"address": ftsoRewardManager.address}, Number(ethers.utils.formatEther(totalUnclaimedAwardsOutstandingWei)));
      } catch (e) {
        this.set({"address": ftsoRewardManager.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}
