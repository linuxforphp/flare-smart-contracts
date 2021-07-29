# FTSO Reward Claiming

During the FTSO price voting process, rewards are being distributed to price (data) providers based on their WFlr vote power. Depending on the vote power share and price provider fee percentage, a part of this reward belongs to users who delegated their WFlr vote power to the price providers. The rewards can be claimed via the contract [FtsoRewardManager](../../contracts/ftso/implementation/FtsoRewardManager.sol) that implements [IFtsoRewardManager](../../contracts/userInterfaces/IFtsoRewardManager.sol) as described in this document.

## Reward claim

Reward claiming process depends on vote power delegation mode. The default delegation mode is delegation by percentage. Delegation by amount is intended for advanced users. The delegation mode of a user can be checked by calling `delegationModeOf` on the [WFlr](../../contracts/token/implementation/WFlr.sol) contract that implements [IVPToken](../../contracts/userInterfaces/IVPToken.sol) interface.

### Delegation by percentage

The user that has delegated vote power by percentage can claim rewards by calling the function `claimReward` with the following signature.

```
function claimReward(
    address payable _recipient,
    uint256[] memory _rewardEpochs
) external returns (
  	uint256 _rewardAmount
)
```

Parameters:
- `_recipient`: The address to which the reward is transferred (can be different from the calling address).
- `_rewardEpochs`: The list of reward epoch ids for which the reward is being claimed.
- `_rewardAmount`: The amount of claimed rewards that is transferred to `_recipient`. The amount is the sum of all rewards that the caller (`msg.sender`) is entitled to in the specified `_rewardEpochs` (i.e., it includes the unclaimed rewards for all price providers the user has delegated to).

Note that this function throws an exception if it is called by a user (`msg.sender`) that is delegating by amount.

To specify an appropriate input array `_rewardEpochs`, the function `getEpochsWithUnclaimedRewards` can be used. It iterates over the past reward epochs that still enable reward claiming and gathers the ids of those, for which the reward allocated to `_beneficiary` has not yet been (fully) claimed.

```
function getEpochsWithUnclaimedRewards(
    address _beneficiary
) external view override returns (
    uint256[] memory _epochIds
)
```

To obtain more detailed information on reward status, its origin and amount, a user can use the functions `getStateOfRewards` or `getStateOfRewardsFromDataProviders` described later in the document.

A user that is delegating by percentage can also use the function `claimRewardFromDataProviders` (described in the following section) to claim the rewards only for specific price providers (e.g., if the user wishes to have rewards from different price providers transferred to different recipient addresses). However, the gas consumption for calling `claimRewardFromDataProviders` is larger.

### Delegation by amount

A user delegating vote power by amount can claim rewards by calling the function `claimRewardFromDataProviders` with the following signature.

```
function claimRewardFromDataProviders(
    address payable _recipient,
    uint256[] memory _rewardEpochs,
    address[] memory _dataProviders
) external returns (
    uint256 _rewardAmount
)
```

Parameters:
-	`_recipient`: The address to which the reward is transferred (can be different from the calling address).
-	`_rewardEpochs`: The list of reward epoch ids for which the reward is being claimed.
- `_dataProviders`: The list of addresses corresponding to price providers.
-	`_rewardAmount`: The amount of claimed rewards that is transferred to `_recipient`. The amount is the sum of all rewards that the caller (`msg.sender`) is entitled to in the specified `_rewardEpochs` (i.e., it includes the unclaimed rewards for all price providers specified in `_dataProviders`).

The main difference in comparison to `claimReward` is that `claimRewardFromDataProviders` requires a user to specify the array `_dataProviders` containing the addresses of price providers that the user has delegated the vote power to.

To prepare the input array `_rewardEpochs`, a user that is delegating by amount can not use the function `getEpochsWithUnclaimedRewards` (a request fails with exception). Instead, the function `getEpochsWithClaimableRewards` can be called to get the information on the reward epochs for which the reward is still claimable, and `getStateOfRewardsFromDataProvider` to obtain details about the state of rewards in a specific (claimable) reward epoch. Below is a code snippet describing this procedure. The functions and their parameters are in more detail explained in the subsequent sections. 

```
(startEpochId, endEpochId) = getEpochsWithUnclaimedRewards();
for (uint256 epochId = startEpochId; epochId <= endEpochId; epochId++) {
    (...) = getStateOfRewardsFromDataProviders(..., epochId, ...);
}
```

### Events

For every call of `claimReward` or `claimRewardFromDataProviders` one or more events of the following type are issued. A specific event is associated with a single pair of price provider and reward epoch.

```
event RewardClaimed(
    address indexed dataProvider,
    address indexed whoClaimed,
    address indexed sentTo,
    uint256 rewardEpoch, 
    uint256 amount
)
```

Parameters:

- `dataProvider`: The address to which the reward was allocated.
- `whoClaimed`: The address from which the reward claim was initiated.
- `sentTo`: The address to which the `amount` was sent.
- `rewardEpoch`: The id of the reward epoch the claimed reward corresponds to.
- `amount`: The value of the claimed reward.

### Reward claim expiry

The reward can be claimed from the time the reward was allocated until the reward expiry epoch. The oldest and the newest reward epoch that allow reward claiming can be obtained by calling `getEpochsWithClaimableRewards` (these correspond to the return values `_startEpochId` and `_endEpochId`, respectively).

```
function getEpochsWithClaimableRewards() external view returns  (
    uint256 _startEpochId,
    uint256 _endEpochId
)
```

The reward expiry epoch is also communicated through `RewardClaimsExpired` event.

```
event RewardClaimsExpired(
    uint256 rewardEpochId
)
```

The information for which epochs the rewards have been already claimed can be obtained by checking the state of rewards described in the following section.

## Reward amount

### Overview

Suppose a total reward amount `REWARD` is allocated to a price provider `P` for a reward epoch `E`. This reward is divided among `P` and users who delegated to `P` depending on the WFlr vote power share and `P`'s fee percentage.

Let `PVP` be the total WFlr vote power associated with `P`. This is the sum of `P`'s own undelegated WFlr vote power and the WFlr vote powers that have been delegated to `P`. The state correspodns to a specific timestamp in `E` (this timestamp is called vote power block).

Supose `SHARE` is the vote power share:
- for `P` this is the ratio between `P`'s own undelegated WFlr vote power and `PVP`,
- for delegator this is the ratio between the WFlr vote power that the delegator has delegated to `P` and `PVP`.

Suppose `FP` denotes `P`'s fee percentage for `E`.

Then `P` is entitled to the reward equal to (`SHARE` * (1 - `FP`) * `REWARD`) + (`FP` * `REWARD`), and a delegator is entitled to the amount equal to `SHARE` * (1 - `FP`) * `REWARD`.

### State of rewards

The reward amounts for a specific address can be checked by calling either `getStateOfRewards` or `getStateOfRewardsFromDataProviders`. The difference between these two functions is that in the first the array of price providers (to which the reward is initially allocated) is obtained based on delegation history, while in the second the array has to be specified as an input paramer.  Note that `getStateOfRewards` can only be used for addresses that are declared to be delegating by percentage.

```
function getStateOfRewards(
    address _beneficiary,
    uint256 _rewardEpoch
) external view returns (
    address[] memory _dataProviders,
    uint256[] memory _rewardAmounts,
    bool[] memory _claimed,
    bool _claimable
)
```

```
function getStateOfRewardsFromDataProviders(
    address _beneficiary,
    uint256 _rewardEpoch,
    address[] memory _dataProviders
) external view returns (
    uint256[] memory _rewardAmounts,
    bool[] memory _claimed,
    bool _claimable
)
```

Parameters:

- `_beneficiary`: The address for which the state is being checked.
- `_rewardEpoch`: The id of the reward epoch for which the state is being checked.
- `_dataProviders`: The positional array of addresses representing the price providers the rewards have been allocated to.
- `_rewardAmounts`: The positional array of values representing the reward amounts the `_beneficiary` is entitled to.
- `_claimed`: The positional array of boolean values indicating if the reward amount has already been claimed.
- `_claimable`: The boolean value indicating if the reward amounts are claimable (i.e., are available and have not expired).

Note that the amounts reported by these two methods are informational and can slightly differ from the actual amounts obtained via `claimReward` and `claimRewardFromDataProviders` due to rounding.

## Reward fee

### Current fee percentage

Price provider fee is determined by fee percentage. Current setting can be obatined by `getDataProviderCurrentFeePercentage`.

```
function getDataProviderCurrentFeePercentage(
    address _dataProvider
) external view returns (
    uint256 _feePercentageBIPS
)
```

The value `_feePercentageBIPS` is given in basis points (BIPS), which is a percentage value multiplied by 100 (e.g., 10% fee is 1000).

### Scheduled fee percentage changes

The fee percentage is subject to changes. The changes made by a price providers are time locked, meaning they are scheduled for some future time. Scheduled changes can be checked by calling `getDataProviderScheduledFeePercentageChanges`, which returns the fee percentages in future.

```
function getDataProviderScheduledFeePercentageChanges(
    address _dataProvider
) external view returns (
    uint256[] memory _feePercentageBIPS,
    uint256[] memory _validFromEpoch,
    bool[] memory _fixed
)
```

Parameters:
- `_dataProvder`: The address representing a price provider.
- `_feePercentageBIPS`: The positional array of scheduled fee percentages in BIPS.
- `validFromEpoch`: The positional array of future reward epoch ids from which the value in `_feePercentageBIPS` will be effective.
- `_fixed`: The positional array of boolean values indicating if the setting is fixed.

If the scheduled fee percentage is not fixed, this means that it can still be updated by price provider over the course of the current reward epoch. After the current reward epoch passes, the setting becomes fixed.

### Setting fee percentage

A price provider can change its fee percentage (`_feePercentageBIPS`) by calling `setDataProviderFeePercentage`.

```
function setDataProviderFeePercentage(
    uint256 _feePercentageBIPS
) external returns (
    uint256 _validFromEpoch
)
```

The change becomes effective in one of the future epochs (`_validFromEpoch`), which is also reported in the following event issued by the function call.

```
event FeePercentageChanged(
    address indexed dataProvider,
    uint256 value,
    uint256 validFromEpoch
)
```

Note that the fee percentage setting can be updated during the current reward epoch, after that the value becomes fixed.