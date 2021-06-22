// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../ftso/interface/IIFtso.sol";
import "../../ftso/interface/IIFtsoManager.sol";


interface IFtsoRegistry {

    function setFtsoManagerAddress(IIFtsoManager _ftsoManager) external;

    function addFtso(IIFtso _ftsoContract) external;

    function removeFtso(string memory _symbol) external;

    function getFtso(string memory _symbol) external view returns(IIFtso _activeFtsoAddress);

    function getSupportedSymbols() external view returns(string[] memory _supportedSymbols);

    function getSupportedSymbolsAndFtsos() external view 
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsoAddresses);

    function getSupportedFtsos() external view returns(IIFtso[] memory _ftsoAddresses);

    function getCurrentPrice(string memory _symbol) external view returns(uint256 _price, uint256 _timestamp);
}
