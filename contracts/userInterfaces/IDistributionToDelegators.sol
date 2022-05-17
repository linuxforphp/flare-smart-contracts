// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

interface IDistributionToDelegators {
    // Events
    event EntitlementStarted();
    event AccountClaimed(address indexed whoClaimed, address indexed sentTo, uint256 month, uint256 amountWei);
    event AccountOptOut(address indexed theAccount, bool confirmed);

    // Methods
    function optOutOfAirdrop() external;
    function claim(address payable _recipient, uint256 _month) external returns(uint256 _amountWei);
    function claimToPersonalDelegationAccount(uint256 _month) external returns(uint256 _amountWei);
    function getClaimableAmount(uint256 _month) external view returns(uint256 _amountWei);
    function getClaimableAmountOf(address account, uint256 _month) external view returns(uint256 _amountWei);
    function getClaimedAmount(uint256 _month) external view returns(uint256 _amountWei);
    function getClaimedAmountOf(address _account, uint256 _month) external view returns(uint256 _amountWei);
    function getCurrentMonth() external view returns (uint256 _currentMonth);
    function getMonthToExpireNext() external view returns (uint256 _monthToExpireNext);
    function secondsTillNextClaim() external view returns(uint256 _timetill);
}
