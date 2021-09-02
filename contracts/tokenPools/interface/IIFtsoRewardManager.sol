// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IFtsoRewardManager.sol";

interface IIFtsoRewardManager is IFtsoRewardManager {

    event DailyAuthorizedInflationSet(uint256 authorizedAmountWei);
    event InflationReceived(uint256 amountReceivedWei);

    function activate() external;
    function deactivate() external;
    function closeExpiredRewardEpoch(uint256 _rewardEpochId) external;

    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochDurationSeconds,
        uint256 currentRewardEpoch,
        uint256 priceEpochEndTime,
        uint256 votePowerBlock
    ) external;

    /**
     * @notice Returns the information on unclaimed reward of `_dataProvider` for `_rewardEpoch`
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing the data provider
     * @return _amount              number representing the unclaimed amount
     * @return _weight              number representing the share that has not yet been claimed
     */
    function getUnclaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider
    )
        external view
        returns (
            uint256 _amount,
            uint256 _weight
        );
}
