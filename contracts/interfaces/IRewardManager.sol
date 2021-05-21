// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../ftso/interface/IIFtsoManager.sol";
import "../implementations/WFLR.sol";

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

    event FundsReceived(
        address indexed sender,
        uint256 amount
    );

    event RewardClaimed(
        address indexed dataProvider,
        address indexed whoClaimed,
        address indexed sentTo,
        uint256 rewardEpoch, 
        uint256 amount
    );
    
    event RewardDistributedByFtso(
        address indexed ftso,
        uint256 epochId,
        address[] addresses,
        uint256[] rewards
    );

    event FeePercentageChanged(
        address indexed dataProvider,
        uint256 value,
        uint256 validFromEpoch
    );

    event RewardClaimsExpired(
        uint256 rewardEpochId
    );

    ///@dev sender claims his reward
    function claimReward(
        address payable recipient,
        uint256[] memory rewardEpoch
    ) external returns(uint256 rewardAmount);
    
    function closeExpiredRewardEpochs() external;

    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochsRemaining,
        uint256 currentRewardEpoch
    ) external returns (bool);

    function setFTSOManager(IIFtsoManager _ftsoManager) external;
    
    function setWFLR(WFLR _wFlr) external;

    ///@dev each data provider can update sharing percentage of rewards
    /// if not set, a default percentage is used
    function setDataProviderFeePercentage(
        uint256 _percentageBPS
    ) external returns (
        uint256 _validFromEpoch
    );

    function getDataProviderCurrentFeePercentage(
        address _dataProvider
    ) external view returns (
        uint256 _feePercentageBIPS
    );

    function getDataProviderScheduledFeePercentageChanges(
        address _dataProvider
    ) external view returns (
        uint256[] memory _feePercentageBIPS,
        uint256[] memory _validFromEpoch,
        bool[] memory _fixed
    );
}
