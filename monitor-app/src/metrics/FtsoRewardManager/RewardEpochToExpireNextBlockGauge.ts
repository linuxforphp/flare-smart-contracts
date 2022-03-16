import { Gauge } from "prom-client";
import { FtsoManager, FtsoRewardManager } from "../../../typechain"
import { getMetricResponseTimeHistogram } from "../MetricResponseTimeHistogram";

const REWARD_EPOCH_TO_EXPIRE_NEXT_BLOCK = "ftso_reward_manager_reward_epoch_to_expire_next_block";
/**
 * @public
 */
export function makeRewardEpochToExpireNextBlockGauge (ftsoRewardManager: FtsoRewardManager, ftsoManager: FtsoManager): Gauge<string> {
  return new Gauge({
    name: REWARD_EPOCH_TO_EXPIRE_NEXT_BLOCK,
    help: "The votepower block number of the reward epoch to expire next",
    labelNames: ["address"],
    async collect() {
      const metricResponseTime = getMetricResponseTimeHistogram();
      const stopTimer = metricResponseTime.startTimer({ metric: REWARD_EPOCH_TO_EXPIRE_NEXT_BLOCK});
      try {
        const rewardEpochToExpireNext = await ftsoRewardManager.getRewardEpochToExpireNext();
        const rewardEpochToExpireNextBlock = await ftsoManager.getRewardEpochVotePowerBlock(rewardEpochToExpireNext);
        this.set({"address": ftsoRewardManager.address}, rewardEpochToExpireNextBlock.toNumber());
      } catch (e) {
        this.set({"address": ftsoRewardManager.address}, 0);
      } finally {
        stopTimer();
      }
    }
  });
}