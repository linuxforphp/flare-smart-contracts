// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/Ftso.sol";


contract SimpleMockFtso is Ftso {
    using FtsoEpoch for FtsoEpoch.State;
    
    constructor(
        string memory _symbol,
        IIVPToken _wFlr,
        IIFtsoManager _ftsoManager,
        IISupply _supply,
        uint256 _initialPrice,
        uint256 _priceDeviationThresholdBIPS
    ) 
        Ftso(_symbol, _wFlr, _ftsoManager, _supply, _initialPrice, _priceDeviationThresholdBIPS) 
    {}

    /**
     * @notice Submits price hash for current epoch
     * @param _hash                 Hashed price and random number
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHash(bytes32 _hash) external whenActive {
        _submitPriceHash(msg.sender, _hash);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) external whenActive {
        _revealPrice(msg.sender, _epochId, _price, _random, flrVotePowerCached(msg.sender));
    }
    
    function readVotes(uint256 _epochId) external view 
        returns (
            uint256[] memory _price,
            uint256[] memory _weight,
            uint256[] memory _weightFlr
        )
    {
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        return _readVotes(epoch);
    }

    function getWeightRatio(
        uint256 _epochId, 
        uint256 _weightFlrSum, 
        uint256 _weightAssetSum
    )
        external view
        returns (uint256) 
    {
        return FtsoEpoch._getWeightRatio(epochs.instance[_epochId], _weightFlrSum, _weightAssetSum);
    }
    
    function getVotePowerOf(address _owner) public returns (uint256 _votePowerFlr, uint256 _votePowerAsset) {
        return _getVotePowerOf(epochs.instance[lastRevealEpochId], _owner, flrVotePowerCached(_owner));
    }

    // Simplified version of vote power weight calculation (no vote commit/reveal, but result should be equal)
    function getVotePowerWeights(address[] memory _owners) public returns (uint256[] memory _weights) {
        FtsoEpoch.Instance storage epoch = epochs.instance[lastRevealEpochId];
        uint256[] memory weightsFlr = new uint256[](_owners.length);
        uint256[] memory weightsAsset = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            (uint256 votePowerFlr, uint256 votePowerAsset) = 
                _getVotePowerOf(epoch, _owners[i], flrVotePowerCached(_owners[i]));
            FtsoEpoch._addVote(epoch, _owners[i], votePowerFlr, votePowerAsset, 0, 0);
            FtsoVote.Instance memory vote = epoch.votes[epoch.votes.length - 1];
            weightsFlr[i] = vote.weightFlr;
            weightsAsset[i] = vote.weightAsset;
        }
        return FtsoEpoch._computeWeights(epoch, weightsFlr, weightsAsset);
    }
}
