// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

interface IDistribution {
    // Events
    event EntitlementStarted(address indexed theContract);
    event AccountClaimed(address indexed theAccount);
    event AccountOptOut(address indexed theAccount);
    event OptOutWeiWithdrawn(address indexed theContract);
    event AccountsAdded(address[] accountsArray);

    // Methods
    function claim() external returns(uint256 _amountWei);
    function optOutOfAirdrop() external;
    function getClaimableAmount(address account) external view 
        returns(uint256 _amountWei);
    function secondsTillNextClaim() external view returns(uint256 timetill);
}
