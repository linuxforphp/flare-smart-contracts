// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../ftso/interface/IIFtso.sol";
import "../ftso/interface/IIFtsoManager.sol";


interface IFtsoRegistry {

    function getFtso(uint256 _ftsoIndex) external view returns(IIFtso _activeFtsoAddress);
    function getFtsoBySymbol(string memory _symbol) external view returns(IIFtso _activeFtsoAddress);

    function getSupportedIndices() external view returns(uint256[] memory _supportedIndices);

    function getSupportedIndicesAndFtsos() external view 
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos);

    function getSupportedSymbolsAndFtsos() external view 
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos);

    function getSupportedFtsos() external view returns(IIFtso[] memory _ftsos);

    function getFtsoIndex(string memory _symbol) external view returns (uint256 _assetIndex);

    function getCurrentPrice(uint256 _ftosIndex) external view returns(uint256 _price, uint256 _timestamp);
    
    function getCurrentPrice(string memory _symbol) external view returns(uint256 _price, uint256 _timestamp);
}
