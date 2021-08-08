// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


/**
 * @title A library used for Ftso Manager settings management
 */
library FtsoManagerSettings {
    struct State {
        // struct holding settings related to FTSOs
        // configurable settings
        uint256 votePowerBlock; // current block at which the vote power is checked
        uint256 maxVotePowerFlrThresholdFraction; // high threshold for FLR vote power per voter
        uint256 maxVotePowerAssetThresholdFraction; // high threshold for asset vote power per voter
        uint256 lowAssetUSDThreshold; // threshold for low asset vote power (in scaled USD)
        uint256 highAssetUSDThreshold; // threshold for high asset vote power (in scaled USD)
        uint256 highAssetTurnoutThresholdBIPS; // threshold for high asset turnout (in BIPS)
        uint256 lowFlrTurnoutThresholdBIPS; // actual vote power in (W)FLRs / total FLR circulating supply (in BIPS)
        uint256 rewardExpiryOffsetSeconds; // Reward epoch closed earlier than 
                                           //block.timestamp - rewardExpiryOffsetSeconds expire
        address[] trustedAddresses; //trusted addresses will be used as a fallback mechanism for setting the price
        bool changed;
        bool initialized;
    }

    function _setState (
        State storage _state,
        uint256 _maxVotePowerFlrThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowFlrTurnoutThresholdBIPS,
        uint256 _rewardExpiryOffsetSeconds,
        address[] memory _trustedAddresses
    ) 
        internal
    {
        if(_state.maxVotePowerFlrThresholdFraction != _maxVotePowerFlrThresholdFraction) {
            _state.changed = true;
            _state.maxVotePowerFlrThresholdFraction = _maxVotePowerFlrThresholdFraction;
        }
        if(_state.maxVotePowerAssetThresholdFraction != _maxVotePowerAssetThresholdFraction) {
            _state.changed = true;
            _state.maxVotePowerAssetThresholdFraction = _maxVotePowerAssetThresholdFraction;
        }
        if(_state.lowAssetUSDThreshold != _lowAssetUSDThreshold) {
            _state.changed = true;
            _state.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        }
        if(_state.highAssetUSDThreshold != _highAssetUSDThreshold) {
            _state.changed = true;
            _state.highAssetUSDThreshold = _highAssetUSDThreshold;
        }
        if(_state.highAssetTurnoutThresholdBIPS != _highAssetTurnoutThresholdBIPS) {
            _state.changed = true;
            _state.highAssetTurnoutThresholdBIPS = _highAssetTurnoutThresholdBIPS;
        }
        if(_state.lowFlrTurnoutThresholdBIPS != _lowFlrTurnoutThresholdBIPS) {
            _state.changed = true;
            _state.lowFlrTurnoutThresholdBIPS = _lowFlrTurnoutThresholdBIPS;
        }
        if(_state.rewardExpiryOffsetSeconds != _rewardExpiryOffsetSeconds) {
            _state.changed = true;
            _state.rewardExpiryOffsetSeconds = _rewardExpiryOffsetSeconds;
        }
        if(_state.trustedAddresses.length != _trustedAddresses.length) {            
            _state.trustedAddresses = _trustedAddresses;
            _state.changed = true;        
        } else {
            for(uint i = 0; i < _trustedAddresses.length; i++) {
                if(_state.trustedAddresses[i] != _trustedAddresses[i]) {
                    _state.changed = true;
                    _state.trustedAddresses[i] = _trustedAddresses[i];
                }
            }
        }
        _state.initialized = true;
    }
}
