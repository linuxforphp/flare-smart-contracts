// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/Ftso.sol";


contract SimpleMockFtso is Ftso {
    using FtsoEpoch for FtsoEpoch.State;
    
    constructor(
        string memory _symbol,
        IPriceSubmitter _priceSubmitter,
        IIVPToken _wNat,
        IIFtsoManager _ftsoManager,
        uint256 _initialPrice,
        uint256 _priceDeviationThresholdBIPS,
        uint256 _cyclicBufferSize
    ) 
        Ftso(
            _symbol,
            _priceSubmitter,
            _wNat,
            _ftsoManager,
            _initialPrice,
            _priceDeviationThresholdBIPS,
            _cyclicBufferSize
        )
    {}

    /**
     * @notice Submits price hash for current epoch
     * @param _epochId              Target epoch id to which hashes are submitted
     * @param _hash                 Hashed price and random number
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHash(uint256 _epochId, bytes32 _hash) external whenActive {
        _submitPriceHash(msg.sender, _epochId, _hash);
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
        _revealPrice(msg.sender, _epochId, _price, _random, wNatVotePowerCached(msg.sender, _epochId));
    }
    
    function readVotes(uint256 _epochId) external view 
        returns (
            uint256[] memory _price,
            uint256[] memory _weight,
            uint256[] memory _weightNat
        )
    {
        FtsoEpoch.Instance storage epoch = _getEpochInstance(_epochId);
        return _readVotes(epoch);
    }

    function getWeightRatio(
        uint256 _epochId, 
        uint256 _weightNatSum, 
        uint256 _weightAssetSum
    )
        external view
        returns (uint256) 
    {
        return FtsoEpoch._getWeightRatio(_getEpochInstance(_epochId), _weightNatSum, _weightAssetSum);
    }
    
    function getVotePowerOf(address _owner) public returns (uint256 _votePowerNat, uint256 _votePowerAsset) {
        FtsoEpoch.Instance storage epoch = _getEpochInstance(lastRevealEpochId);

        return _getVotePowerOf(
            epoch,
            _owner,
            wNatVotePowerCached(_owner, lastRevealEpochId),
            epoch.fallbackMode,
            uint256(epoch.votePowerBlock)
        );
    }

    // Simplified version of vote power weight calculation (no vote commit/reveal, but result should be equal)
    function getVotePowerWeights(address[] memory _owners) public returns (uint256[] memory _weights) {
        FtsoEpoch.Instance storage epoch = _getEpochInstance(lastRevealEpochId);
        uint256[] memory weightsNat = new uint256[](_owners.length);
        uint256[] memory weightsAsset = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            (uint256 votePowerNat, uint256 votePowerAsset) = _getVotePowerOf(
                epoch,
                _owners[i],
                wNatVotePowerCached(_owners[i], lastRevealEpochId),
                epoch.fallbackMode,
                uint256(epoch.votePowerBlock)
            );
            FtsoEpoch._addVote(epoch, _owners[i], votePowerNat, votePowerAsset, 0, 0);
            FtsoVote.Instance memory vote = epoch.votes[epoch.nextVoteIndex - 1];
            weightsNat[i] = vote.weightNat;
            weightsAsset[i] = vote.weightAsset;
        }
        return FtsoEpoch._computeWeights(epoch, weightsNat, weightsAsset);
    }
}
