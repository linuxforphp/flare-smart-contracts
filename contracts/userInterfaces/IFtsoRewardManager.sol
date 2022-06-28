// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

interface IFtsoRewardManager {

    event RewardClaimed(
        address indexed dataProvider,
        address indexed whoClaimed,
        address indexed sentTo,
        uint256 rewardEpoch, 
        uint256 amount
    );

    event UnearnedRewardsAccrued(
        uint256 epochId,
        uint256 reward
    );

    event RewardsDistributed(
        address indexed ftso,
        uint256 epochId,
        address[] addresses,
        uint256[] rewards
    );

    event RewardClaimsEnabled(
        uint256 rewardEpochId
    ); 

    event FeePercentageChanged(
        address indexed dataProvider,
        uint256 value,
        uint256 validFromEpoch
    );

    event RewardClaimsExpired(
        uint256 rewardEpochId
    );    

    /**
     * @notice Allows a percentage delegator to claim rewards.
     * @notice This function is intended to be used to claim rewards in case of delegation by percentage.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
     */
    function claimReward(address payable _recipient, uint256[] memory _rewardEpochs)
        external returns (uint256 _rewardAmount);

    /**
     * @notice Allows a percentage delegator to claim and wrap rewards.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by percentage.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
     */
    function claimAndWrapReward(address payable _recipient, uint256[] memory _rewardEpochs)
        external returns (uint256 _rewardAmount);

    /**
     * @notice Allows a percentage delegator to claim and wrap rewards.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by percentage.
     * @notice The caller does not have to be the owner, but must be allowed by owner by calling `addClaimExecutor`.
     *   It is actually safe for this to be called by anybody (nothing can be stolen), but by limiting who can
     *   call, we allow the owner to control the timing of the calls.
     * @param _rewardOwner          address of the reward owner; also, funds will be tranfered there
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
     */
    function claimAndWrapRewardToOwner(
        address payable _rewardOwner,
        uint256[] memory _rewardEpochs
    ) external returns (uint256 _rewardAmount);

    /**
     * @notice Allows the sender to claim rewards from specified data providers.
     * @notice This function is intended to be used to claim rewards in case of delegation by amount.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Function can be used by a percentage delegator but is more gas consuming than `claimReward`.
     */
    function claimRewardFromDataProviders(
        address payable _recipient,
        uint256[] memory _rewardEpochs,
        address[] memory _dataProviders
    )
        external
        returns (uint256 _rewardAmount);

    /**
     * @notice Allows the sender to claim and wrap rewards from specified data providers.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by amount.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Function can be used by a percentage delegator but is more gas consuming than `claimReward`.
     */
    function claimAndWrapRewardFromDataProviders(
        address payable _recipient,
        uint256[] memory _rewardEpochs,
        address[] memory _dataProviders
    )
        external
        returns (uint256 _rewardAmount);

    /**
     * @notice Allows the sender to claim and wrap rewards from specified data providers.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by amount.
     * @notice The caller does not have to be the owner, but must be allowed by owner by calling `addClaimExecutor`.
     *   It is actually safe for this to be called by anybody (nothing can be stolen), but by limiting who can
     *   call, we allow the owner to control the timing of the calls.
     * @param _rewardOwner          address of the reward owner; also, funds will be tranfered there
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Function can be used by a percentage delegator but is more gas consuming than `claimReward`.
     */
    function claimAndWrapRewardFromDataProvidersToOwner(
        address payable _rewardOwner,
        uint256[] memory _rewardEpochs,
        address[] memory _dataProviders
    ) 
        external
        returns (uint256 _rewardAmount);
        
    /**
     * Called by reward owner to allow `_executor` to call `claimAndWrapRewardToOwner` or 
     * `claimAndWrapRewardFromDataProvidersToOwner`.
     * @param _executor the account that will be able to call the `claim to owner` methods
     */
    function addClaimExecutor(address _executor) external;

    /**
     * Called by reward owner to revoke the allowance of `_executor` to call `claimAndWrapRewardToOwner` or 
     * `claimAndWrapRewardFromDataProvidersToOwner`.
     * @param _executor the account that won't be able to call the `claim to owner` methods any more
     */
    function removeClaimExecutor(address _executor) external;
        
    /**
     * @notice Allows data provider to set (or update last) fee percentage.
     * @param _feePercentageBIPS    number representing fee percentage in BIPS
     * @return _validFromEpoch      reward epoch number when the setting becomes effective.
     */
    function setDataProviderFeePercentage(uint256 _feePercentageBIPS)
        external returns (uint256 _validFromEpoch);

    /**
     * @notice Allows reward claiming
     */
    function active() external view returns (bool);

    /**
     * @notice Returns the current fee percentage of `_dataProvider`
     * @param _dataProvider         address representing data provider
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider)
        external view returns (uint256 _feePercentageBIPS);

    /**
     * @notice Returns the fee percentage of `_dataProvider` at `_rewardEpoch`
     * @param _dataProvider         address representing data provider
     * @param _rewardEpoch          reward epoch number
     */
    function getDataProviderFeePercentage(
        address _dataProvider,
        uint256 _rewardEpoch
    )
        external view
        returns (uint256 _feePercentageBIPS);

    /**
     * @notice Returns the scheduled fee percentage changes of `_dataProvider`
     * @param _dataProvider         address representing data provider
     * @return _feePercentageBIPS   positional array of fee percentages in BIPS
     * @return _validFromEpoch      positional array of block numbers the fee setings are effective from
     * @return _fixed               positional array of boolean values indicating if settings are subjected to change
     */
    function getDataProviderScheduledFeePercentageChanges(address _dataProvider) external view 
        returns (
            uint256[] memory _feePercentageBIPS,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        );

    /**
     * @notice Returns information on epoch reward
     * @param _rewardEpoch          reward epoch number
     * @return _totalReward         number representing the total epoch reward
     * @return _claimedReward       number representing the amount of total epoch reward that has been claimed
     */
    function getEpochReward(uint256 _rewardEpoch) external view
        returns (uint256 _totalReward, uint256 _claimedReward);

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @return _dataProviders       positional array of addresses representing data providers
     * @return _rewardAmounts       positional array of reward amounts
     * @return _claimed             positional array of boolean values indicating if reward is claimed
     * @return _claimable           boolean value indicating if rewards are claimable
     * @dev Reverts when queried with `_beneficary` delegating by amount
     */
    function getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch
    )
        external view 
        returns (
            address[] memory _dataProviders,
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        );

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch` from `_dataProviders`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @param _dataProviders        positional array of addresses representing data providers
     * @return _rewardAmounts       positional array of reward amounts
     * @return _claimed             positional array of boolean values indicating if reward is claimed
     * @return _claimable           boolean value indicating if rewards are claimable
     */
    function getStateOfRewardsFromDataProviders(
        address _beneficiary,
        uint256 _rewardEpoch,
        address[] memory _dataProviders
    )
        external view
        returns (
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        );

    /**
     * @notice Returns the start and the end of the reward epoch range for which the reward is claimable
     * @param _startEpochId         the oldest epoch id that allows reward claiming
     * @param _endEpochId           the newest epoch id that allows reward claiming
     */
    function getEpochsWithClaimableRewards() external view 
        returns (
            uint256 _startEpochId,
            uint256 _endEpochId
        );

    /**
     * @notice Returns the array of claimable epoch ids for which the reward has not yet been claimed
     * @param _beneficiary          address of reward beneficiary
     * @return _epochIds            array of epoch ids
     * @dev Reverts when queried with `_beneficary` delegating by amount
     */
    function getEpochsWithUnclaimedRewards(address _beneficiary) external view returns (
        uint256[] memory _epochIds
    );

    /**
     * @notice Returns the information on claimed reward of `_dataProvider` for `_rewardEpoch` by `_claimer`
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing the data provider
     * @param _claimer              address representing the claimer
     * @return _claimed             boolean indicating if reward has been claimed
     * @return _amount              number representing the claimed amount
     */
    function getClaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider,
        address _claimer
    )
        external view
        returns (
            bool _claimed,
            uint256 _amount
        );

    /**
     * @notice Return reward epoch that will expire, when new reward epoch will start
     * @return Reward epoch id that will expire next
     */
    function getRewardEpochToExpireNext() external view returns (uint256);

    /**
     * @notice Return reward epoch vote power block
     * @param _rewardEpoch          reward epoch number
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view returns (uint256);

    /**
     * @notice Return current reward epoch number
     */
    function getCurrentRewardEpoch() external view returns (uint256);

    /**
     * @notice Return initial reward epoch number
     */
    function getInitialRewardEpoch() external view returns (uint256);

    /**
     * @notice Returns the information on rewards and initial vote power of `_dataProvider` for `_rewardEpoch`
     * @param _rewardEpoch                      reward epoch number
     * @param _dataProvider                     address representing the data provider
     * @return _rewardAmount                    number representing the amount of rewards
     * @return _votePowerIgnoringRevocation     number representing the vote power ignoring revocations
     */
    function getDataProviderPerformanceInfo(
        uint256 _rewardEpoch,
        address _dataProvider
    )
        external view 
        returns (
            uint256 _rewardAmount,
            uint256 _votePowerIgnoringRevocation
        );
}
