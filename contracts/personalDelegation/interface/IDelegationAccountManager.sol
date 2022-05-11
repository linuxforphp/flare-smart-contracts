// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../tokenPools/interface/IIFtsoRewardManager.sol";
import "../../userInterfaces/IDistribution.sol";

interface IDelegationAccountManager {

    event SetLibraryAddress(address libraryAddress);
    event CreateDelegationAccount(address delegationAccount, address owner);

    function setLibraryAddress(address _libraryAddress) external;

    function createDelegationAccount() external;

    function addFtsoRewardManager(IIFtsoRewardManager _ftsoRewardManager) external;

    function addDistribution(IDistribution _distribution) external;

    function ftsoRewardManagersLength() external view returns(uint256);

    function distributionsLength() external view returns(uint256);
    
}