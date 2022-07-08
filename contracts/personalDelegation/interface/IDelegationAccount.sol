// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../tokenPools/interface/IIFtsoRewardManager.sol";
import "../../token/implementation/WNat.sol";
import "../../userInterfaces/IDistributionToDelegators.sol";
import "../../token/interface/IIGovernanceVotePower.sol";
import "../implementation/DelegationAccountManager.sol";

interface IDelegationAccount {

    event ClaimFtsoRewards(address delegationAccount, uint256[] rewardEpochs, uint256 amount,
        IIFtsoRewardManager ftsoRewardManager);
    event ClaimAirdrop(address delegationAccount, uint256 amount, uint256 month,
        IDistributionToDelegators distribution);
    event DelegateFtso(address delegationAccount, address to, uint256 bips);
    event DelegateGovernance(address delegationAccount, address to, uint256 balance);
    event UndelegateAllFtso(address delegationAccount);
    event UndelegateGovernance(address delegationAccount);
    event SetExecutor(address delegationAccount, address executor);
    event RemoveExecutor(address delegationAccount, address executor);
    event WidthrawToOwner(address delegationAccount, uint256 amount);
    event Initialize(address owner, DelegationAccountManager manager);
    event ClaimFtsoFailure(string err, IIFtsoRewardManager ftsoRewardManager);
    event ClaimDistributionFailure(string err, IDistributionToDelegators distribution);
    event EpochsWithUnclaimedRewardsFailure(string err, IIFtsoRewardManager ftsoRewardManager);

    function claimFtsoRewards(uint256[] memory _epochs) external returns(uint256);

    function claimAllFtsoRewards() external returns(uint256);

    function claimAirdropDistribution(uint256 _month) external returns(uint256);

    function delegate(address _to, uint256 _bips) external;

    function undelegateAll() external;

    function revokeDelegationAt(address _who, uint256 _blockNumber) external;

    function delegateGovernance(address _to) external;

    function undelegateGovernance() external;

    function setExecutor(address _executor) external;

    function removeExecutor(address _executor) external;

    function withdraw(uint256 _amount) external;
    
    function transferExternalToken(IERC20 _token, uint256 _amount) external;
}