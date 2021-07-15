// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/VoterWhitelister.sol";

contract VoterWhitelisterMock is VoterWhitelister {
    constructor(
        address _governance,
        IIPriceSubmitter _priceSubmitter, 
        uint256 _defaultMaxVotersForFtso
    ) VoterWhitelister(_governance, _priceSubmitter, _defaultMaxVotersForFtso) {
    }
    
    function mockSetFtsoRegistry(IFtsoRegistry _ftsoRegistry) public {
        ftsoRegistry = _ftsoRegistry;
    }
    
    function mockAddFtso(uint256 _ftsoIndex) public {
        _addFtso(_ftsoIndex);
    }
    
    function mockRemoveFtso(uint256 _ftsoIndex) public {
        _removeFtso(_ftsoIndex);
    }
    
    function minVotePowerIndex(
        address[] memory _addresses,
        uint256 _ftsoIndex
    ) public returns (uint256) {
        return _minVotePowerIndex(_addresses, _ftsoIndex);
    }
    
    function getVotePowers(
        IIVPToken _token, 
        address[] memory _addresses, 
        uint256 _blockNumber
    ) public returns (uint256[] memory) {
        return _getVotePowers(_token, _addresses, _blockNumber);
    }
    
    function getVotePowerWeights(
        IIFtso ftso,
        address[] memory _addresses
    ) public returns (uint256[] memory _votePowers) {
        return _getVotePowerWeights(ftso, _addresses);
    }
    
    function getFlareVotePowerWeights(
        IIVPToken _wflr,
        uint256 _totalVotePowerFlr,
        address[] memory _addresses, 
        uint256 _blockNumber
    ) public returns (uint256[] memory _flrVP) {
        return _getFlareVotePowerWeights(_wflr, _totalVotePowerFlr, _addresses, _blockNumber);
    }
    
    function getAssetVotePowerWeights(
        IIVPToken[] memory _assets,
        uint256[] memory _assetMultipliers,
        uint256 _totalVotePowerAsset,
        address[] memory _addresses, 
        uint256 _blockNumber
    ) public returns (uint256[] memory _combinedAssetVP) {
        return _getAssetVotePowerWeights(_assets, _assetMultipliers, _totalVotePowerAsset, _addresses, _blockNumber);
    }
    
    function getWhitelist(uint256 _ftsoIndex) public view returns (address[] memory _whitelist) {
        return whitelist[_ftsoIndex];
    }
    
}
