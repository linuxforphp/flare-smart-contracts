// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/Ftso.sol";

contract MockFtso is Ftso {
    using FtsoEpoch for FtsoEpoch.State;

    constructor(
        string memory _symbol,
        IIVPToken _wFlr,
        IIFtsoManager _ftsoManager,
        IISupply _supply,
        uint256 _startTimestamp,
        uint256 _submitPeriod,
        uint256 _revealPeriod,
        uint256 _initialPrice,
        uint256 _priceDeviationThresholdBIPS
    ) Ftso(_symbol, _wFlr, _ftsoManager, _supply, _initialPrice, _priceDeviationThresholdBIPS) {
        // Init only when sensible settings. Otherwise use mock similarly like Ftso.sol
        if (_submitPeriod != 0 && _revealPeriod != 0) {

            // configureEpochs
            epochs.maxVotePowerFlrThreshold = 1;
            epochs.maxVotePowerAssetThreshold = 1;
            epochs.lowAssetUSDThreshold = 1000;
            epochs.highAssetUSDThreshold = 10000;
            epochs.highAssetTurnoutBIPSThreshold = 50;
            epochs.lowFlrTurnoutBIPSThreshold = 1500;
            epochs.trustedAddresses = new address[](0);

            // activateFtso
            epochs.firstEpochStartTime = _startTimestamp;
            epochs.submitPeriod = _submitPeriod;
            epochs.revealPeriod = _revealPeriod;
            active = true;
        }
    }

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
        _revealPrice(msg.sender, _epochId, _price, _random);
    }

    function getWeightRatio(uint256 _epochId) external view returns (uint256) {
        return FtsoEpoch._getWeightRatio(epochs.instance[_epochId]);
    }
    
    function getVotePowerOf(address _owner) public returns (uint256 _votePowerFlr, uint256 _votePowerAsset) {
      return _getVotePowerOf(epochs.instance[lastRevealEpochId], _owner);
    }

    // Simplified version of vote power weight calculation (no vote commit/reveal, but result should be equal)
    function getVotePowerWeights(address[] memory _owners) public returns (uint256[] memory _weights) {
        FtsoEpoch.Instance storage epoch = epochs.instance[lastRevealEpochId];
        uint256[] memory weightsFlr = new uint256[](_owners.length);
        uint256[] memory weightsAsset = new uint256[](_owners.length);
        uint256 sumFlr = 0;
        uint256 sumAsset = 0;
        for (uint256 i = 0; i < _owners.length; i++) {
            (uint256 votePowerFlr, uint256 votePowerAsset) = _getVotePowerOf(epoch, _owners[i]);
            uint256 voteId = FtsoVote._createInstance(votes, _owners[i], votePowerFlr, votePowerAsset, 
                epoch.votePowerFlr, epoch.votePowerAsset, 0);
            FtsoVote.Instance storage vote = votes.instance[voteId];
            weightsFlr[i] = vote.weightFlr;
            weightsAsset[i] = vote.weightAsset;
            sumFlr += vote.weightFlr;
            sumAsset += vote.weightAsset;
        }
        epoch.weightFlrSum = sumFlr;
        epoch.weightAssetSum = sumAsset;
        epoch.voteCount = _owners.length;
        return FtsoEpoch._computeWeights(epoch, weightsFlr, weightsAsset);
    }

}
