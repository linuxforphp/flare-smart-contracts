// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IFtso.sol";
import "../IVotePower.sol";
import "../interfaces/IRewardManager.sol";
import "./WeightedMedian.sol";

contract Ftso is IFtso {

    struct Vote {                               // struct holding vote data
        uint128 price;                          // submitted price
        uint64 weightFlr;                       // flare weight
        uint64 weightAsset;                     // asset weight
    }
    
    struct Epoch {                              // struct holding epoch votes and results
        uint256 votePowerBlock;                 // block used to obtain vote weights in epoch
        uint256 weightFlrSum;                   // sum of all FLR weights in epoch votes
        uint256 weightAssetSum;                 // sum of all asset weights in epoch votes
        uint256 firstVoteId;                    // id of the first vote in epoch
        uint256 truncatedFirstQuartileVoteId;   // first vote id eligible for reward
        uint256 firstQuartileVoteId;            // vote id corresponding to the first quartile
        uint256 medianVoteId;                   // vote id corresponding to the median
        uint256 lastQuartileVoteId;             // vote id corresponding to the last quartile
        uint256 truncatedLastQuartileVoteId;    // last vote id eligible for reward
        uint256 lastVoteId;                     // id of the last vote in epoch
        uint256 medianPrice;                    // consented epoch asset price
        uint256 lowRewardedPrice;               // the lowest submitted price eligible for reward
        uint256 highRewardedPrice;              // the highest submitted price elibible for reward
        uint256 lowWeightSum;                   // sum of (mixed) weights on votes with price too low for reward
        uint256 rewardedWeightSum;              // sum of (mixed) weights on votes eligible for reward
        uint256 highWeightSum;                  // sum of (mixed) weights on votes with price too high for reward
        uint256 flrLowWeightSum;                // sum of FLR weights on votes with price too low for reward
        uint256 flrRewardedWeightSum;           // sum of FLR weights on votes eligible for reward
        uint256 flrHighWeightSum;               // sum of FLR weights on votes with price too high for reward
        uint32 voteRewardCount;                 // number of votes in epoch eligible for the reward
        uint32 voteCount;                       // number of votes in epoch
    }

    uint256 internal immutable fAssetDecimals;
    bool internal immutable randomizedPivot;
    bool internal immutable relinkResults;
    IVotePower public immutable fFlr;                 // wrapped FLR
    IVotePower public immutable fAsset;               // wrapped asset
    IRewardManager public rewardManager;            // reward manager contract
    uint256 public immutable minVotePower;    
    uint256 public firstEpochStartTimestamp;
    uint256 public epochPeriod;
    uint256 public revealPeriod;

    uint256 internal voteId;
    uint256 internal currentVotepowerBlock;
    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;
    mapping(uint256 => Vote) internal votes;
    mapping(uint256 => uint256) internal nextVoteId;
    mapping(uint256 => address) internal voteSender;
    mapping(uint256 => Epoch) internal epochs;
    mapping(uint256 => uint256) internal epochRandom;
    mapping(address => mapping(uint256 => uint256)) internal voterEpochPrice;

    event EpochId(uint _epochId);   // event to communicate epoch with price submitter, see submitPrice

    constructor(
        IVotePower _fFlr,
        IVotePower _fAsset,
        uint256 _fAssetDecimals,
        IRewardManager _rewardManager,
        uint256 _minVotePower,
        bool _randomizedPivot,
        bool _relinkResults
    ) {
        fFlr = _fFlr;
        fAsset = _fAsset;
        fAssetDecimals = _fAssetDecimals;
        rewardManager = _rewardManager;
        minVotePower = _minVotePower;
        randomizedPivot = _randomizedPivot;
        relinkResults = _relinkResults;
    }

    modifier onlyRewardManager {
        require(msg.sender == address(rewardManager), "Access denied");
        _;
    }

    function submitPrice(bytes32 _hash) external {
        require(firstEpochStartTimestamp > 0, "Ftso not initialized");
        // TODO: check if msg.sender has required vote power (minVotePower): needs to be discussed
        uint256 epochId = getCurrentEpoch();
        epochVoterHash[epochId][msg.sender] = _hash;    // TODO: reuse slots? (in discussion)
        emit EpochId(epochId);
    }

    function setCurrentVotepowerBlock(uint256 _votepowerBlock) external override onlyRewardManager {
        currentVotepowerBlock = _votepowerBlock;
    }

    function revealPrice(uint256 _epochId, uint128 _price, uint256 _random) external {
        require(canRevealPriceForEpoch(_epochId), "Price reveal for epoch not possible");
        require(epochVoterHash[_epochId][msg.sender] == keccak256(abi.encodePacked(_price, _random)),
            "Price already revealed or not valid");        

        voteId++;
        
        epochRandom[_epochId] += _random;
        voterEpochPrice[msg.sender][_epochId] = _price;

        Epoch storage epoch = epochs[_epochId];
        if (epoch.firstVoteId == 0) {
            // first vote in epoch
            epoch.firstVoteId = voteId;
            epoch.lastVoteId = voteId;
            epoch.voteCount = 1;
            epoch.votePowerBlock = currentVotepowerBlock;
        } else {
            // epoch already contains votes, add a new one to the list
            nextVoteId[epoch.lastVoteId] = voteId;
            epoch.lastVoteId = voteId;
            epoch.voteCount += 1;
        }

        Vote storage vote = votes[voteId];
        vote.price = _price;
        vote.weightFlr = getFlrWeight(epoch.votePowerBlock);
        vote.weightAsset = getAssetWeight(epoch.votePowerBlock);
        // TODO: check weights?
        voteSender[voteId] = msg.sender;
        
        delete epochVoterHash[_epochId][msg.sender];
    }

    function epochPrice(uint256 _epochId) external view returns (uint256) {
        return epochs[_epochId].medianPrice;
    }

    function epochPriceForVoter(uint256 _epochId, address _voter) external view returns (uint256) {
        return voterEpochPrice[_voter][_epochId];
    }

    function getFreshRandom() external view override returns (uint256) {
        return epochRandom[getCurrentEpoch()];
    }

    function getEpochData() external view override returns (uint256, uint256, uint256) {
        // TODO: not sure the output is set correctly
        uint256 epochId = getCurrentEpoch();
        uint256 nextPriceSubmitEndTs = epochEnd(epochId);
        return (epochId, nextPriceSubmitEndTs, nextPriceSubmitEndTs + revealPeriod);
    }

    function finalizePriceEpoch(uint256 _epochId, bool _returnRewardData) public override onlyRewardManager
        returns (
            address[] memory eligibleAddresses,
            uint64[] memory flrWeights,
            uint256 flrWeightsSum
        )
    {
        require(block.timestamp > epochEnd(_epochId) + revealPeriod, "Epoch not ready for finalization");

        Epoch storage epoch = epochs[_epochId];
        // TODO: check if epoch exists and has sufficient votes

        // extract data from epoch votes to memory
        uint256[] memory vote;
        uint128[] memory price;
        uint256[] memory weight;
        uint64[] memory weightFlr;
        (vote, price, weight, weightFlr) = readVotes(epoch);

        // compute weighted median and truncated quartiles
        uint32[] memory index;
        WeightedMedian.Data memory data;
        (index, data) = WeightedMedian.compute(price, weight);

        // store epoch results
        writeEpochRewardData(epoch, data, index, weightFlr);
        writeEpochPriceData(epoch, data, index, price, vote);

        // return reward data if requested
        if (_returnRewardData) {
            (eligibleAddresses, flrWeights, flrWeightsSum) = readRewardData(epoch, data, index, weightFlr, vote);
        }
    }

    function initPriceEpochData(
        uint256 _firstEpochStartTs,
        uint256 _epochPeriod,
        uint256 _revealPeriod
    )
        public override onlyRewardManager
    {
        firstEpochStartTimestamp = _firstEpochStartTs;
        epochPeriod = _epochPeriod;
        revealPeriod = _revealPeriod;
    }

    function getCurrentEpoch() public view returns (uint256) {
        return (block.timestamp - firstEpochStartTimestamp) / epochPeriod;
    }

    function canRevealPriceForEpoch(uint256 _epochId) public view returns (bool) {
        uint256 end = epochEnd(_epochId);
        return end < block.timestamp && block.timestamp <= end + revealPeriod;
    }

    function readVotes(Epoch storage _epoch) internal returns (
        uint256[] memory vote,
        uint128[] memory price,
        uint256[] memory weight,
        uint64[] memory weightFlr
    ) {
        uint length = _epoch.voteCount;

        vote = new uint256[](length);
        price = new uint128[](length);
        weight = new uint256[](length);
        weightFlr = new uint64[](length);

        uint64[] memory weightAsset = new uint64[](length);
        uint256 weightFlrSum = 0;
        uint256 weightAssetSum = 0;
        uint256 id = _epoch.firstVoteId;

        for(uint32 i = 0; i < length; i++) {
            Vote storage v = votes[id];
            vote[i] = id;
            price[i] = v.price;
            weightFlr[i] = v.weightFlr;
            weightAsset[i] = v.weightAsset;
            weightFlrSum += weightFlr[i];
            weightAssetSum += weightAsset[i];
            id = nextVoteId[id];
        }

        for (uint32 i = 0; i < length; i++) {            
            weight[i] = weightAssetSum * weightFlr[i] + weightFlrSum * weightAsset[i];
        }

        _epoch.weightFlrSum = weightFlrSum;
        _epoch.weightAssetSum = weightAssetSum;
    }

    function writeEpochRewardData(
        Epoch storage epoch,
        WeightedMedian.Data memory data,
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
        Epoch storage epoch,
        WeightedMedian.Data memory data, 
        uint32[] memory index,
        uint128[] memory price,
        uint256[] memory vote
    ) internal
    {
        if (relinkResults) {
            for (uint32 i = 0; i < data.length - 1; i++) {
                nextVoteId[vote[index[i]]] = vote[index[i + 1]];
            }
        }

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
        Epoch storage epoch,
        WeightedMedian.Data memory data,
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
                eligibleAddresses[cnt] = voteSender[id];
                flrWeights[cnt] = weightFlr[index[i]];
                cnt++;
            }
        }        
        flrWeightsSum = epoch.flrRewardedWeightSum;          
    }

    function epochEnd(uint256 _epochId) internal view returns (uint256) {
        return firstEpochStartTimestamp + (_epochId + 1) * epochPeriod;
    }

    function getFlrWeight(uint256 votePowerBlock) internal view returns (uint64) {
        // TODO: check for overflows
        // TODO: divide?
        return uint64(fFlr.votePowerOfAt(msg.sender, votePowerBlock));
    }

    function getAssetWeight(uint256 votePowerBlock) internal view returns (uint64) {
        // TODO: check for overflows
        return uint64(fAsset.votePowerOfAt(msg.sender, votePowerBlock) / fAssetDecimals);
    }

}
