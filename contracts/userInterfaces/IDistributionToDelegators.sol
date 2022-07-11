// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

interface IDistributionToDelegators {
    // Events
    event EntitlementStart(uint256 entitlementStartTs);
    event AccountClaimed(address indexed whoClaimed, address indexed sentTo, uint256 month, uint256 amountWei);
    event AccountOptOut(address indexed theAccount, bool confirmed);
    event ClaimExecutorsChanged(address rewardOwner, address[] executors);
    event AllowedClaimRecipientsChanged(address rewardOwner, address[] recipients);


    // Methods
    function optOutOfAirdrop() external;
    function claim(address _recipient, uint256 _month) external returns(uint256 _amountWei);
    function claimAndWrap(address _recipient, uint256 _month) external returns(uint256 _amountWei);
    function claimToPersonalDelegationAccount(uint256 _month) external returns(uint256 _amountWei);
    function claimByExecutor(address _rewardOwner, address _recipient, uint256 _month)
        external returns(uint256 _amountWei);
    function claimAndWrapByExecutor(address _rewardOwner, address _recipient, uint256 _month)
        external returns(uint256 _amountWei);
    function claimToPersonalDelegationAccountByExecutor(address _rewardOwner, uint256 _month) 
        external returns(uint256 _amountWei);
    function setClaimExecutors(address[] memory _executors) external;
    function setAllowedClaimRecipients(address[] memory _recipients) external;

    function getClaimableAmount(uint256 _month) external view returns(uint256 _amountWei);
    function getClaimableAmountOf(address account, uint256 _month) external view returns(uint256 _amountWei);
    function getClaimedAmount(uint256 _month) external view returns(uint256 _amountWei);
    function getClaimedAmountOf(address _account, uint256 _month) external view returns(uint256 _amountWei);
    function getCurrentMonth() external view returns (uint256 _currentMonth);
    function getMonthToExpireNext() external view returns (uint256 _monthToExpireNext);
    function secondsTillNextClaim() external view returns(uint256 _timetill);
    function claimExecutors(address _rewardOwner) external view returns (address[] memory);
    function allowedClaimRecipients(address _rewardOwner) external view returns (address[] memory);
}
