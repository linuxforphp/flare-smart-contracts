// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/// @info High level
/// The reward contract handles price submission rewards
/// Reward flow:
///     - trigger: reveal period ended.
///     - Per epock, Randomly choose next FTSO to reward.
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
interface IRewardContract {

    ///@dev sender claims his reward
    function claimReward(address to, uint256 amountTwei) external returns(bool succeess);

    ///@dev, each data provider can update sharing percentage of rewards
    /// if not set, a default percentage is used
    function setDataProviderSharingPercentage(uint256 percentageBPS) external;
}
