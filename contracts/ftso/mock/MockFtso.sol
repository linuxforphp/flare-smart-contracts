// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/Ftso.sol";

contract MockFtso is Ftso {
    using FtsoEpoch for FtsoEpoch.State;

    constructor(
        string memory _symbol,
        IFAsset _wFlr,
        IIFtsoManager _ftsoManager,
        uint256 _startTimestamp,
        uint256 _submitPeriod,
        uint256 _revealPeriod,
        uint256 _initialPrice
    ) Ftso(_symbol, _wFlr, _ftsoManager, _initialPrice) {
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
}
