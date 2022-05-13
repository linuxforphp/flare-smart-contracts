// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../tokenPools/interface/IIFtsoRewardManager.sol";
import "../../userInterfaces/IDistributionToDelegators.sol";
import "../implementation/DelegationAccountClonable.sol";

interface IDelegationAccountManager {

    event SetLibraryAddress(address libraryAddress);
    event CreateDelegationAccount(address delegationAccount, address owner);

    function setLibraryAddress(address _libraryAddress) external;

    function createDelegationAccount() external returns (DelegationAccountClonable);

    function getFtsoRewardManagers() external view returns(IIFtsoRewardManager[] memory);

    function getDistributions() external view returns(IDistributionToDelegators[] memory);

}
