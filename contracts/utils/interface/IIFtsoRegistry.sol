// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../ftso/interface/IIFtso.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "../../userInterfaces/IFtsoRegistry.sol";


interface IIFtsoRegistry is IFtsoRegistry {

    function setFtsoManagerAddress(IIFtsoManager _ftsoManager) external;

    // returns ftso index
    function addFtso(IIFtso _ftsoContract) external returns(uint256);

    function removeFtso(IIFtso _ftso) external;
}
