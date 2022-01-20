// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../userInterfaces/IFtsoRegistry.sol";
import "../../userInterfaces/IPriceSubmitter.sol";


contract PriceReader is AddressUpdatable {
    
    struct PriceInfo {
        string symbol;
        uint256 price;
        uint256 random;
        IFtso ftsoAddress;
        uint256 ftsoIndex;
    }

    IFtsoRegistry public ftsoRegistry;

    constructor(address _addressUpdater) AddressUpdatable(_addressUpdater) { }

    function getAllCurrentPrices() external view returns (PriceInfo[] memory) {
        // Get one valid ftso
        ( , IIFtso[] memory ftsos) = ftsoRegistry.getSupportedIndicesAndFtsos();
        return _getAllPrices(ftsos[0].getCurrentEpochId());
    }

    function getAllPrices(uint256 _epochId) external view returns (PriceInfo[] memory) {
        return _getAllPrices(_epochId);
    }

    function getPricesByIndices(uint256 _epochId, uint256[] memory _indices) external view returns (uint256[] memory) {
        uint256[] memory prices = new uint256[](_indices.length); 
        
        for(uint256 i = 0; i < _indices.length; ++i){
            prices[i] = ftsoRegistry.getFtso(_indices[i]).getEpochPrice(_epochId);
        }
        return prices;
    }

    function getCurrentPricesByIndices(uint256[] memory _indices) external view returns (uint256[] memory) {
        uint256[] memory prices = new uint256[](_indices.length); 
        
        uint256 currentEpochId = ftsoRegistry.getFtso(_indices[0]).getCurrentEpochId();

        for(uint256 i = 0; i < _indices.length; ++i){
            prices[i] = ftsoRegistry.getFtso(_indices[i]).getEpochPrice(currentEpochId);
        }
        return prices;
    }

    function getPricesBySymbols(uint256 _epochId, string[] memory _symbols) external view returns (uint256[] memory) {
        uint256[] memory prices = new uint256[](_symbols.length); 
        
        for(uint256 i = 0; i < _symbols.length; ++i){
            prices[i] = ftsoRegistry.getFtsoBySymbol(_symbols[i]).getEpochPrice(_epochId);
        }
        return prices;
    }

    function getCurrentPricesBySymbols(string[] memory _symbols) external view returns (uint256[] memory) {
        uint256[] memory prices = new uint256[](_symbols.length); 
        
        uint256 currentEpochId = ftsoRegistry.getFtsoBySymbol(_symbols[0]).getCurrentEpochId();

        for(uint256 i = 0; i < _symbols.length; ++i){
            prices[i] = ftsoRegistry.getFtsoBySymbol(_symbols[i]).getEpochPrice(currentEpochId);
        }
        return prices;
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        ftsoRegistry = IFtsoRegistry(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
    }

    function _getAllPrices(uint256 epochId) internal view returns (PriceInfo[] memory) {

        (uint[] memory indices, IIFtso[] memory ftsos) = ftsoRegistry.getSupportedIndicesAndFtsos();

        uint256 length = ftsos.length;
        PriceInfo[] memory result = new PriceInfo[](length);

        for(uint256 j = 0; j < length; ++j){
            result[j].symbol = ftsos[j].symbol();
            result[j].price = ftsos[j].getEpochPrice(epochId);
            // Randoms are shifted by one
            result[j].random = ftsos[j].getRandom(epochId - 1);
            result[j].ftsoAddress = ftsos[j];
            result[j].ftsoIndex = indices[j];
        }

        return result;
    }

}
