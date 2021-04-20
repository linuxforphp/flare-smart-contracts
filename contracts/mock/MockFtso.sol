// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IFAsset.sol";
import "../interfaces/IFtsoManager.sol";
import "../implementations/Ftso.sol";

contract MockFtso is Ftso {
    using FtsoEpoch for FtsoEpoch.State;

    struct ResultVars {
        uint256 id;
        uint32 len;
        uint32 truncatedFirstQuartileIndex;
        uint32 firstQuartileIndex;
        uint32 medianIndex;
        uint32 lastQuartileIndex;
        uint32 truncatedLastQuartileIndex;
    }

    event FinalizeEpochResults(
        address[] eligibleAddresses,
        uint256[] flrWeights,
        uint256 flrWeightsSum
    );

    constructor(
        IFAsset _fFlr,
        IFAsset _fAsset,
        IFtsoManager _ftsoManager,
        uint256 _startTimestamp,
        uint256 _submitPeriod,
        uint256 _revealPeriod
    ) Ftso(_fFlr, _fAsset, _ftsoManager) {
        // Init only when sensible settings. Otherwise use mock similarly like Ftso.sol
        if (_submitPeriod != 0 && _revealPeriod != 0) {
            initEpoch(_startTimestamp, _submitPeriod, _revealPeriod);
            configureEpoch(0, 1e10, 1e10, 1, 1, 1000, 10000, 50);
        }
    }

    function initEpoch(
        uint256 _firstEpochStartTime,
        uint256 _submitPeriod,
        uint256 _revealPeriod
    ) public {
        require(!active, ERR_ALREADY_ACTIVATED);
        epochs.firstEpochStartTime = _firstEpochStartTime;
        epochs.submitPeriod = _submitPeriod;
        epochs.revealPeriod = _revealPeriod;
        active = true;
    }

    function configureEpoch(
        uint256 _minVoteCount,
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThreshold
    ) internal {
        epochs.minVoteCount = _minVoteCount;
        epochs.minVotePowerFlrThreshold = _minVotePowerFlrThreshold;
        epochs.minVotePowerAssetThreshold = _minVotePowerAssetThreshold;
        epochs.maxVotePowerFlrThreshold = _maxVotePowerFlrThreshold;
        epochs.maxVotePowerAssetThreshold = _maxVotePowerAssetThreshold;
        epochs.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        epochs.highAssetUSDThreshold = _highAssetUSDThreshold;
        epochs.highAssetTurnoutThreshold = _highAssetTurnoutThreshold;
    }

    function setCurrentPrice(uint256 _price) external {
        fAssetPriceUSD = _price;
    }

    function epochCount(uint256 _epochId) external view returns (uint256) {
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        return epoch.voteCount;
    }

    function getVoteInfo(uint256 _epochId)
        external
        view
        returns (
            uint256 epochId,
            uint256[] memory prices,
            uint256[] memory weightsFlr,
            uint256[] memory weightsAsset
        )
    {
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        uint256 id = epoch.firstVoteId;
        uint32 len = epoch.voteCount;
        epochId = _epochId;
        prices = new uint256[](len);
        weightsFlr = new uint256[](len);
        weightsAsset = new uint256[](len);
        for (uint32 cnt = 0; cnt < len; cnt++) {
            FtsoVote.Instance storage vote = votes.instance[id];
            prices[cnt] = vote.price;
            weightsFlr[cnt] = vote.weightFlr;
            weightsAsset[cnt] = vote.weightAsset;
            id = epochs.nextVoteId[id];
        }
    }

    function getWeightRatio(uint256 _epochId) external view returns (uint256) {
        return epochs._getWeightRatio(epochs.instance[_epochId]);
    }

    function getEpochResult(uint256 _epochId)
        external
        view
        returns (
            uint256 epochId,
            uint256[] memory votePrices,
            uint256[] memory weightsFlr,
            uint256[] memory weightsAsset,
            uint32[] memory medians,
            uint256[] memory prices,
            uint256[] memory weights
        )
    {
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        ResultVars memory r = ResultVars(0, 0, 0, 0, 0, 0, 0);

        epochId = _epochId;
        r.len = epoch.voteCount;
        votePrices = new uint256[](r.len);
        weightsFlr = new uint256[](r.len);
        weightsAsset = new uint256[](r.len);
        r.id = epoch.firstVoteId;

        for (uint32 cnt = 0; cnt < r.len; cnt++) {
            FtsoVote.Instance storage vote = votes.instance[r.id];
            votePrices[cnt] = vote.price;
            weightsFlr[cnt] = vote.weightFlr;
            weightsAsset[cnt] = vote.weightAsset;
            if (r.id == epoch.firstQuartileVoteId) {
                r.firstQuartileIndex = cnt;
            }
            if (r.id == epoch.truncatedFirstQuartileVoteId) {
                r.truncatedFirstQuartileIndex = cnt;
            }
            if (r.id == epoch.medianVoteId) {
                r.medianIndex = cnt;
            }
            if (r.id == epoch.lastQuartileVoteId) {
                r.lastQuartileIndex = cnt;
            }
            if (r.id == epoch.truncatedLastQuartileVoteId) {
                r.truncatedLastQuartileIndex = cnt;
            }
            r.id = epochs.nextVoteId[r.id];
        }
        medians = new uint32[](5);
        prices = new uint256[](3);
        weights = new uint256[](6);

        medians[0] = r.truncatedFirstQuartileIndex;
        medians[1] = r.firstQuartileIndex;
        medians[2] = r.medianIndex;
        medians[3] = r.lastQuartileIndex;
        medians[4] = r.truncatedLastQuartileIndex;

        prices[0] = uint256(epoch.lowRewardedPrice);
        prices[1] = uint256(epoch.medianPrice);
        prices[2] = uint256(epoch.highRewardedPrice);

        weights[0] = epoch.lowWeightSum;
        weights[1] = epoch.rewardedWeightSum;
        weights[2] = epoch.highWeightSum;
        weights[3] = epoch.flrLowWeightSum;
        weights[4] = epoch.flrRewardedWeightSum;
        weights[5] = epoch.flrHighWeightSum;
    }

}
