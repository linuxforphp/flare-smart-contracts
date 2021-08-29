// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IDataAvailabilityRewardManager {

    event RewardClaimed(
        address indexed whoClaimed,
        address indexed sentTo,
        uint256 rewardEpoch, 
        uint256 amount
    );

    event RewardClaimsExpired(
        uint256 rewardEpochId
    );    

    /**
     * @notice This function is intended to be used to claim rewards.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     */
    function claimReward(
        address payable _recipient,
        uint256[] memory _rewardEpochs
    )
        external
        returns (
            uint256 _rewardAmount
        );

    /**
     * @notice Returns information on epoch reward
     * @param _rewardEpoch          reward epoch number
     * @return _totalReward         number representing the total epoch reward
     * @return _claimedReward       number representing the amount of total epoch reward that has been claimed
     */
    function getEpochReward(uint256 _rewardEpoch)
        external view 
        returns (
            uint256 _totalReward,
            uint256 _claimedReward
        );

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @return _amount              reward amount
     * @return _claimed             boolean value indicating if reward is claimed
     * @return _claimable           boolean value indicating if reward is claimable
     */
    function getStateOfRewards(address _beneficiary, uint256 _rewardEpoch) 
        external view
        returns (
            uint256 _amount,
            bool _claimed,
            bool _claimable
        );

    /**
     * @notice Return reward epoch that will expire, when new reward epoch will start
     * @return Reward epoch id that will expire next
     */
    function getRewardEpochToExpireNext() external view returns (uint256);
}
