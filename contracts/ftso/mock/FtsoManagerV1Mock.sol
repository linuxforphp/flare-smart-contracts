// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIFtsoManagerV1.sol";


contract FtsoManagerV1Mock is IIFtsoManagerV1 {

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
        uint256 startTimestamp;
    }

    RewardEpochData[] public override rewardEpochs;

    // price epoch data
    uint256 internal immutable firstPriceEpochStartTs;
    uint256 internal immutable priceEpochDurationSeconds;
    uint256 internal immutable revealEpochDurationSeconds;

    // reward epoch data
    uint256 public immutable override rewardEpochsStartTs;
    uint256 public immutable override rewardEpochDurationSeconds;

    constructor(
        uint256 _firstPriceEpochStartTs,
        uint256 _priceEpochDurationSeconds,
        uint256 _revealEpochDurationSeconds,
        uint256 _rewardEpochsStartTs,
        uint256 _rewardEpochDurationSeconds
    ) {
        // price epoch
        firstPriceEpochStartTs = _firstPriceEpochStartTs;
        priceEpochDurationSeconds = _priceEpochDurationSeconds;
        revealEpochDurationSeconds = _revealEpochDurationSeconds;

        // reward epoch
        rewardEpochsStartTs = _rewardEpochsStartTs;
        rewardEpochDurationSeconds = _rewardEpochDurationSeconds;
    }

    function getPriceEpochConfiguration() external view override
        returns (
            uint256 _firstPriceEpochStartTs,
            uint256 _priceEpochDurationSeconds,
            uint256 _revealEpochDurationSeconds
        )
    {
        return (firstPriceEpochStartTs, priceEpochDurationSeconds, revealEpochDurationSeconds);
    }

    function getCurrentRewardEpoch() external view override returns(uint256) {
        require(rewardEpochs.length > 0, "Reward epoch not initialized yet");
        return rewardEpochs.length - 1;
    }
}
