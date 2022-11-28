// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IFtsoRewardManager.sol";
import "./IDistributionToDelegators.sol";
import "./IDelegationAccountManager.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDelegationAccount {

    event ClaimFtsoRewards(address delegationAccount, uint256[] rewardEpochs, uint256 amount,
        IFtsoRewardManager ftsoRewardManager, bool claimForOwner);
    event ClaimAirdropDistribution(address delegationAccount, uint256 month, uint256 amount,
        IDistributionToDelegators distribution, bool claimForOwner);
    event DelegateFtso(address delegationAccount, address to, uint256 bips);
    event RevokeFtso(address delegationAccount, address to, uint256 blockNumber);
    event UndelegateAllFtso(address delegationAccount);
    event DelegateGovernance(address delegationAccount, address to);
    event UndelegateGovernance(address delegationAccount);
    event WithdrawToOwner(address delegationAccount, uint256 amount);
    event ExternalTokenTransferred(address delegationAccount, IERC20 token, uint256 amount);
    event ExecutorFeePaid(address delegationAccount, address executor, uint256 amount);
    event Initialize(address owner, IDelegationAccountManager manager);
    event ClaimFtsoRewardsFailure(string err, IFtsoRewardManager ftsoRewardManager, bool claimForOwner);
    event ClaimAirdropDistributionFailure(string err, IDistributionToDelegators distribution, bool claimForOwner);
}
