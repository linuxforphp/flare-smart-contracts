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

    constructor(
        string memory _symbol,
        IFAsset _fFlr,
        IFtsoManager _ftsoManager,
        uint256 _startTimestamp,
        uint256 _submitPeriod,
        uint256 _revealPeriod,
        uint256 _initialPrice
    ) Ftso(_symbol, _fFlr, _ftsoManager, _initialPrice) {
        // Init only when sensible settings. Otherwise use mock similarly like Ftso.sol
        if (_submitPeriod != 0 && _revealPeriod != 0) {

            // configureEpochs
            epochs.minVotePowerFlrThreshold = 1e10;
            epochs.minVotePowerAssetThreshold = 1e10;
            epochs.maxVotePowerFlrThreshold = 1;
            epochs.maxVotePowerAssetThreshold = 1;
            epochs.lowAssetUSDThreshold = 1000;
            epochs.highAssetUSDThreshold = 10000;
            epochs.highAssetTurnoutBIPSThreshold = 50;
            epochs.lowFlrTurnoutBIPSThreshold = 1500;
            epochs.trustedAddresses = new address[](0);

            // initializeEpochs
            epochs.firstEpochStartTime = _startTimestamp;
            epochs.submitPeriod = _submitPeriod;
            epochs.revealPeriod = _revealPeriod;
            active = true;
        }
    }

    function getWeightRatio(uint256 _epochId) external view returns (uint256) {
        return FtsoEpoch._getWeightRatio(epochs.instance[_epochId]);
    }

    function getEpochResult(uint256 _epochId)
        external
        view
        returns (
            uint256 epochId,
            uint32[] memory medians,
            uint256[] memory prices,
            uint256[] memory weights
        )
    {
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];
        ResultVars memory r = ResultVars(0, 0, 0, 0, 0, 0, 0);

        epochId = _epochId;

        r.len = epoch.voteCount;
        r.id = epoch.firstVoteId;

        for (uint32 cnt = 0; cnt < r.len; cnt++) {
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

        prices[0] = epoch.lowRewardedPrice;
        prices[1] = epoch.price;
        prices[2] = epoch.highRewardedPrice;

        weights[0] = epoch.lowWeightSum;
        weights[1] = epoch.rewardedWeightSum;
        weights[2] = epoch.highWeightSum;
        weights[3] = epoch.flrLowWeightSum;
        weights[4] = epoch.flrRewardedWeightSum;
        weights[5] = epoch.flrHighWeightSum;
    }

}
