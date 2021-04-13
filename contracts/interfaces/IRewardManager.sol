// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IFtso.sol";
import "./IFtsoManager.sol";

/// @title IRewardManager high level
/// The reward manager distributes price submission rewards for FLR vote power holders
/// Reward flow:
///     - trigger: reveal period ended.
///     - Per epoch, Randomly choose next FTSO to reward.
///     - Call FTSO to get list of eligible data providers and relative weight.
///     - Update reward balance on the contract
///     - data provider rewards: x% for delegated vote power + own balance reward
///     - users:
///         - iterate list of current delegators and delegated vote power.
///         - per user give (100 - x)% * totalDelegatedPower / userDelegatedVote
///         - update local accounting for this user.
/// Handling FAsset rewards
///     trigger each FAsset contracts to claim rewards for this epoch.
///
/// ClaimReward:
///     - user claims. reduce balance and send tokens.
///     - if not enough balance pull from Inflation contract.
interface IRewardManager {

    event RewardClaimed(
        address indexed whoClaimed,
        address indexed sentTo,
        uint256 indexed rewardEpoch, 
        uint256 amount
    );
    
    event RewardDistributedByFtso(
        address ftso,
        uint256 indexed epochId,
        address[] addresses,
        uint256[] rewards
    );

    ///@dev sender claims his reward
    function claimReward(address payable to, uint256 rewardEpoch) external returns(uint256 rewardAmount);
    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochDurationSec,
        uint256 currentRewardEpoch
    ) external returns (bool);
    function setDailyRewardAmount(uint256 rewardAmountTwei) external;
    function setFTSOManager(IFtsoManager _ftsoManager) external;

    ///@dev each data provider can update sharing percentage of rewards
    /// if not set, a default percentage is used
    function setDataProviderSharingPercentage(uint256 percentageBPS) external;
}
