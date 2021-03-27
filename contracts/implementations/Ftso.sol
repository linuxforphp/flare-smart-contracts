// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IFtso.sol";
import "../IVotePower.sol";
import "../interfaces/IRewardManager.sol";
import "../lib/FtsoEpoch.sol";
import "../lib/FtsoVote.sol";
import "../lib/FtsoMedian.sol";

contract Ftso is IFtso {

    using FtsoEpoch for FtsoEpoch.State;
    using FtsoVote for FtsoVote.State;

    uint256 internal immutable fAssetDecimals;

    bool internal active;
    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;
    FtsoEpoch.State internal epochs;
    FtsoVote.State internal votes;

    IVotePower public immutable fFlr;       // wrapped FLR
    IVotePower public immutable fAsset;     // wrapped asset
    IRewardManager public rewardManager;    // reward manager contract

    event PriceSubmission(address submitter, uint256 epochId);
    event PriceReveal(address voter, uint256 epochId, uint256 price);
    event PriceConsensus(uint256 epochId, uint256 price);

    constructor(
        IVotePower _fFlr,
        IVotePower _fAsset,
        uint256 _fAssetDecimals,
        IRewardManager _rewardManager
    ) {
        fFlr = _fFlr;
        fAsset = _fAsset;
        fAssetDecimals = _fAssetDecimals;
        rewardManager = _rewardManager;
    }

    modifier onlyRewardManager {
        require(msg.sender == address(rewardManager), "Access denied");
        _;
    }

    modifier whenActive {
        require(active, "Ftso not activated");
        _;
    }

    function submitPrice(bytes32 _hash) external whenActive {
        uint256 epochId = getCurrentEpochId();
        epochVoterHash[epochId][msg.sender] = _hash;
        emit PriceSubmission(msg.sender, epochId);
    }

    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) external whenActive {
        require(_price < 2**128, "Price too high");
        require(canRevealPriceForEpoch(_epochId), "Price reveal for epoch not possible");
        require(epochVoterHash[_epochId][msg.sender] == keccak256(abi.encodePacked(_price, _random)),
            "Price already revealed or not valid");
        
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        require(epoch.voteCount < epochs.maxVoteCount, "Maximal number of votes in epoch reached");
        if (epoch.voteCount == 0) {
            epochs._initializeInstance(
                epoch,
                fFlr.votePowerAt(epochs.votePowerBlock),
                fAsset.votePowerAt(epochs.votePowerBlock)
            );
        }

        (uint256 votePowerFlr, uint256 votePowerAsset) = getVotePower(epoch);

        uint128 price = uint128(_price);

        uint256 voteId = votes._createInstance(
            votePowerFlr,
            votePowerAsset,
            epoch.maxVotePowerFlr,
            epoch.maxVotePowerAsset,
            epoch.votePowerFlr,
            epoch.votePowerAsset,
            price
        );

        epochs._submitVote(epoch, voteId, votePowerFlr, votePowerAsset, _random, price);
        
        delete epochVoterHash[_epochId][msg.sender];

        emit PriceReveal(msg.sender, _epochId, _price);
    }

    function setCurrentVotepowerBlock(uint256 _votePowerBlock) external override onlyRewardManager {
        epochs.votePowerBlock = _votePowerBlock;
    }

    function epochPrice(uint256 _epochId) external view returns (uint128) {
        return epochs.instance[_epochId].medianPrice;
    }

    function epochPriceForVoter(uint256 _epochId, address _voter) external view returns (uint256) {
        return epochs.instance[_epochId].voterPrice[_voter];
    }

    function getFreshRandom() external view override returns (uint256) {
        return epochs.instance[getCurrentEpochId()].random;
    }

    function getEpochData() external view override returns (uint256, uint256, uint256) {
        // TODO: not sure the output is set correctly
        uint256 epochId = getCurrentEpochId();
        uint256 nextPriceSubmitEndTs = epochs._epochEndTime(epochId);
        return (epochId, nextPriceSubmitEndTs, nextPriceSubmitEndTs + epochs.revealPeriod);
    }

    function finalizePriceEpoch(uint256 _epochId, bool _returnRewardData) public override onlyRewardManager returns (
        address[] memory eligibleAddresses,
        uint64[] memory flrWeights,
        uint256 flrWeightsSum
    ) {
        require(block.timestamp > epochs._epochEndTime(_epochId) + epochs.revealPeriod, "Epoch not ready for finalization");

        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        require(epoch.voteCount > epochs.minVoteCount, "Epoch has insufficient number of votes");

        // extract data from epoch votes to memory
        uint256[] memory vote;
        uint128[] memory price;
        uint256[] memory weight;
        uint64[] memory weightFlr;
        (vote, price, weight, weightFlr) = readVotes(_epochId, epoch);

        // compute weighted median and truncated quartiles
        uint32[] memory index;
        FtsoMedian.Data memory data;
        (index, data) = FtsoMedian.compute(price, weight);

        // store epoch results
        writeEpochRewardData(epoch, data, index, weightFlr);
        writeEpochPriceData(epoch, data, index, price, vote);

        // return reward data if requested
        if (_returnRewardData) {
            (eligibleAddresses, flrWeights, flrWeightsSum) = readRewardData(epoch, data, index, weightFlr, vote);
        }

        emit PriceConsensus(_epochId, epoch.medianPrice);
    }

    function initPriceEpochData(
        uint256 _firstEpochStartTime,
        uint256 _submissionPeriod,
        uint256 _revealPeriod
    )
        public override onlyRewardManager
    {
        require(!active, "Ftso already activated");
        epochs.firstEpochStartTime = _firstEpochStartTime;
        epochs.submissionPeriod = _submissionPeriod;
        epochs.revealPeriod = _revealPeriod;
        active = true;
    }

    function configure(
        uint256 _epochMaxVoteCount,
        uint256 _minVotePowerFlrDenomination,
        uint256 _minVotePowerAssetDenomination,
        uint256 _maxVotePowerFlrDenomination,
        uint256 _maxVotePowerAssetDenomination,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThreshold
    ) public onlyRewardManager {
        epochs.maxVoteCount = _epochMaxVoteCount;
        epochs.minVotePowerFlrDenomination = _minVotePowerFlrDenomination;
        epochs.minVotePowerAssetDenomination = _minVotePowerAssetDenomination;
        epochs.maxVotePowerFlrDenomination = _maxVotePowerFlrDenomination;
        epochs.maxVotePowerAssetDenomination = _maxVotePowerAssetDenomination;
        epochs.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        epochs.highAssetUSDThreshold = _highAssetUSDThreshold;
        epochs.highAssetTurnoutThreshold = _highAssetTurnoutThreshold;
    }

    function getCurrentEpochId() public view returns (uint256) {
        return getEpochId(block.timestamp);
    }

    function getEpochId(uint256 timestamp) public view returns (uint256) {
        return epochs._getEpochId(timestamp);
    }

    function canRevealPriceForEpoch(uint256 _epochId) public view returns (bool) {
        return epochs._epochRevealInProcess(_epochId);
    }

    function readVotes(uint256 _epochId, FtsoEpoch.Instance storage _epoch) internal returns (
        uint256[] memory vote,
        uint128[] memory price,
        uint256[] memory weight,
        uint64[] memory weightFlr
    ) {
        uint256 length = _epoch.voteCount;

        vote = new uint256[](length);
        price = new uint128[](length);        
        weightFlr = new uint64[](length);

        uint64[] memory weightAsset = new uint64[](length);
        uint256 weightFlrSum = 0;
        uint256 weightAssetSum = 0;
        uint256 id = _epoch.firstVoteId;

        for(uint32 i = 0; i < length; i++) {
            FtsoVote.Instance storage v = votes.instance[id];
            vote[i] = id;
            price[i] = v.price;
            weightFlr[i] = v.weightFlr;
            weightAsset[i] = v.weightAsset;
            weightFlrSum += weightFlr[i];
            weightAssetSum += weightAsset[i];
            id = epochs.nextVoteId[id];
        }

        weight = computeWeights(_epochId, _epoch, weightFlr, weightAsset, weightFlrSum, weightAssetSum, length);

        _epoch.weightFlrSum = weightFlrSum;
        _epoch.weightAssetSum = weightAssetSum;
    }

    function computeWeights(
        uint256 _epochId,
        FtsoEpoch.Instance storage _epoch,
        uint64[] memory weightFlr,
        uint64[] memory weightAsset,
        uint256 weightFlrSum,
        uint256 weightAssetSum,
        uint256 length
    ) internal view returns (uint256[] memory weight)
    {
        uint256 weightRatio = 50;
        if (_epochId > 0) {
            weightRatio = epochs._getWeightRatio(_epoch, epochs.instance[_epochId - 1].medianPrice);
        }

        uint256 flrShare = (1000 - weightRatio) * weightAssetSum;
        uint256 assetShare = weightRatio * weightFlrSum;

        weight = new uint256[](length);
        for (uint32 i = 0; i < length; i++) {            
            weight[i] = flrShare * weightFlr[i] + assetShare * weightAsset[i];
        }
    }

    function writeEpochRewardData(
        FtsoEpoch.Instance storage epoch,
        FtsoMedian.Data memory data,
        uint32[] memory index,
        uint64[] memory weightFlr
    )
        internal
    {
        uint32 voteRewardCount = 0;
        uint256 flrRewardedWeightSum = 0;
        uint256 flrLowWeightSum = 0;
        uint256 flrHighWeightSum = 0;
        for (uint32 i = 0; i < epoch.voteCount; i++) {
            if(i < data.quartile1Index) {
                flrLowWeightSum += weightFlr[index[i]];
            } else if (i > data.quartile3Index) {
                flrHighWeightSum += weightFlr[index[i]];
            } else if (weightFlr[index[i]] > 0) {
                flrRewardedWeightSum += weightFlr[index[i]];
                voteRewardCount++;
            }
        }

        epoch.voteRewardCount = voteRewardCount;
        epoch.flrRewardedWeightSum = flrRewardedWeightSum;
        epoch.flrLowWeightSum = flrLowWeightSum;
        epoch.flrHighWeightSum = flrHighWeightSum;
    }

    function writeEpochPriceData(
        FtsoEpoch.Instance storage epoch,
        FtsoMedian.Data memory data, 
        uint32[] memory index,
        uint128[] memory price,
        uint256[] memory vote
    ) internal
    {
        // relink results
        for (uint32 i = 0; i < data.length - 1; i++) {
            epochs.nextVoteId[vote[index[i]]] = vote[index[i + 1]];
        }

        // store data
        epoch.firstVoteId = vote[index[0]];
        epoch.lastVoteId = vote[index[data.length - 1]];
        epoch.truncatedFirstQuartileVoteId = vote[index[data.quartile1Index]];
        epoch.truncatedLastQuartileVoteId = vote[index[data.quartile3Index]];
        epoch.firstQuartileVoteId = vote[index[data.quartile1IndexOriginal]];
        epoch.lastQuartileVoteId = vote[index[data.quartile3IndexOriginal]];
        epoch.medianVoteId = vote[index[data.medianIndex]];
        epoch.lowRewardedPrice = price[index[data.quartile1Index]];
        epoch.medianPrice = data.finalMedianPrice; 
        epoch.highRewardedPrice = price[index[data.quartile3Index]];
        epoch.lowWeightSum = data.lowWeightSum;
        epoch.highWeightSum = data.highWeightSum;
        epoch.rewardedWeightSum = data.rewardedWeightSum;
    }

    function readRewardData(
        FtsoEpoch.Instance storage epoch,
        FtsoMedian.Data memory data,
        uint32[] memory index, 
        uint64[] memory weightFlr,
        uint256[] memory vote
    ) internal view returns (
        address[] memory eligibleAddresses, 
        uint64[] memory flrWeights,
        uint256 flrWeightsSum
    ) {
        uint32 voteRewardCount = epoch.voteRewardCount;
        eligibleAddresses = new address[](voteRewardCount);
        flrWeights = new uint64[](voteRewardCount);
        uint32 cnt = 0;
        for (uint32 i = data.quartile1Index; i <= data.quartile3Index; i++) {
            if (weightFlr[index[i]] > 0) {
                uint256 id = vote[index[i]];
                eligibleAddresses[cnt] = votes.sender[id];
                flrWeights[cnt] = weightFlr[index[i]];
                cnt++;
            }
        }        
        flrWeightsSum = epoch.flrRewardedWeightSum;          
    }

    function getVotePower(FtsoEpoch.Instance storage _epoch) internal view returns (
        uint256 votePowerFlr,
        uint256 votePowerAsset
    ) {
        votePowerFlr = fFlr.votePowerOfAt(msg.sender, _epoch.votePowerBlock);
        require(votePowerFlr >= _epoch.minVotePowerFlr, "Insufficient FLR vote power to create vote");        
        
        votePowerAsset = fAsset.votePowerOfAt(msg.sender, _epoch.votePowerBlock);
        require(votePowerAsset >= _epoch.minVotePowerAsset, "Insufficient asset vote power to create vote");
        
        if (votePowerFlr > _epoch.maxVotePowerFlr) {
            votePowerFlr = _epoch.maxVotePowerFlr;
        }
        
        if (votePowerAsset > _epoch.maxVotePowerAsset) {
            votePowerAsset = _epoch.maxVotePowerAsset;
        }
    }

}
