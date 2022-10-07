// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


import "../../userInterfaces/IFtsoRewardManager.sol";
import "../../userInterfaces/IDelegationAccountManager.sol";
import "../../token/implementation/WNat.sol";

interface IIDelegationAccountManager is IDelegationAccountManager {
    event SetLibraryAddress(address libraryAddress);

    function setLibraryAddress(address _libraryAddress) external;

    function setMaxFeeValueWei(uint256 _maxFeeValueWei) external;

    function setRegisterExecutorFeeValueWei(uint256 _registerExecutorFeeValueWei) external;

    function removeFtsoRewardManager(IFtsoRewardManager _ftsoRewardManager) external;

    function wNat() external view returns(WNat);
}
