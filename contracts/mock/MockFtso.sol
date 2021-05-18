// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementations/Ftso.sol";

contract MockFtso is Ftso {
    using FtsoEpoch for FtsoEpoch.State;

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

            // activateFtso
            epochs.firstEpochStartTime = _startTimestamp;
            epochs.submitPeriod = _submitPeriod;
            epochs.revealPeriod = _revealPeriod;
            active = true;
        }
    }

    function getWeightRatio(uint256 _epochId) external view returns (uint256) {
        return FtsoEpoch._getWeightRatio(epochs.instance[_epochId]);
    }

    function getEpochResult(uint256 _epochId) external view returns (
        uint256[] memory medians,
        uint256[] memory prices,
        uint256[] memory weights
    ) {
        FtsoEpoch.Instance storage epoch = epochs.instance[_epochId];

        medians = new uint256[](2);
        prices = new uint256[](3);
        weights = new uint256[](6);

        uint256 id = epoch.firstVoteId;
        for (uint256 cnt = 0; cnt < epoch.voteCount; cnt++) {
            if (id == epoch.truncatedFirstQuartileVoteId) {
                medians[0] = cnt;
            }
            if (id == epoch.truncatedLastQuartileVoteId) {
                medians[1] = cnt;
            }
            id = epochs.nextVoteId[id];
        }

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
