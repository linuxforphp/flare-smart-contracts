// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IIFtsoRegistry.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../../ftso/interface/IIFtsoManager.sol";

interface IIPriceSubmitter is IPriceSubmitter{

    function setFtsoManager(IIFtsoManager _ftsoManager) external;
    function setFtsoRegistry(IIFtsoRegistry _ftsoRegistryToSet) external;

    function addFtso(IIFtso _ftso, uint256 _ftsoIndex) external;
    function removeFtso(IIFtso _ftso) external;
 
}

