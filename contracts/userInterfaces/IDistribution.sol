// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

interface IDistribution {
    // Events
    event EntitlementStarted();
    event AccountClaimed(address indexed theAccount);
    event AccountOptOut(address indexed theAccount);
    event OptOutWeiWithdrawn();
    event AccountsAdded(address[] accountsArray);

    // Methods
    function claim() external returns(uint256 _amountWei);
    function optOutOfAirdrop() external;
    function getClaimableAmount() external view returns(uint256 _amountWei);
    function getClaimableAmountOf(address account) external view returns(uint256 _amountWei);
    function secondsTillNextClaim() external view returns(uint256 timetill);
}
