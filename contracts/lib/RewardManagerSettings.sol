// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../IFtso.sol";

/**
 * @title A library used for Reward Manager settings management
 */
library RewardManagerSettings {
    struct State {
        // struct holding settings related to FTSOs
        // configurable settings
        uint256 minVoteCount; // minimal number of votes required in epoch
        uint256 votePowerBlock; // current block at which the vote power is checked
        uint256 minVotePowerFlrThreshold; // low threshold for FLR vote power per voter
        uint256 minVotePowerAssetThreshold; // low threshold for asset vote power per voter
        uint256 maxVotePowerFlrThreshold; // high threshold for FLR vote power per voter
        uint256 maxVotePowerAssetThreshold; // high threshold for asset vote power per voter
        uint256 lowAssetUSDThreshold; // threshold for low asset vote power (in scaled USD)
        uint256 highAssetUSDThreshold; // threshold for high asset vote power (in scaled USD)
        uint256 highAssetTurnoutThreshold; // threshold for high asset turnout (in vote power units)
        IFtso[] fAssetFtsos;
        bool changed;
        bool initialized;
    }

    function _setState (
        State storage _state,
        uint256 _minVoteCount,
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThreshold,
        IFtso[] memory _fAssetFtsos
    ) internal {
        if(_state.minVoteCount != _minVoteCount) {
            _state.changed = true;
            _state.minVoteCount = _minVoteCount;
        }
        if(_state.minVotePowerFlrThreshold != _minVotePowerFlrThreshold) {
            _state.changed = true;
            _state.minVotePowerFlrThreshold = _minVotePowerFlrThreshold;
        }
        if(_state.minVotePowerAssetThreshold != _minVotePowerAssetThreshold) {
            _state.changed = true;
            _state.minVotePowerAssetThreshold = _minVotePowerAssetThreshold;
        }
        if(_state.maxVotePowerFlrThreshold != _maxVotePowerFlrThreshold) {
            _state.changed = true;
            _state.maxVotePowerFlrThreshold = _maxVotePowerFlrThreshold;
        }
        if(_state.maxVotePowerAssetThreshold != _maxVotePowerAssetThreshold) {
            _state.changed = true;
            _state.maxVotePowerAssetThreshold = _maxVotePowerAssetThreshold;
        }
        if(_state.lowAssetUSDThreshold != _lowAssetUSDThreshold) {
            _state.changed = true;
            _state.lowAssetUSDThreshold = _lowAssetUSDThreshold;
        }
        if(_state.highAssetUSDThreshold != _highAssetUSDThreshold) {
            _state.changed = true;
            _state.highAssetUSDThreshold = _highAssetUSDThreshold;
        }
        if(_state.highAssetTurnoutThreshold != _highAssetTurnoutThreshold) {
            _state.changed = true;
            _state.highAssetTurnoutThreshold = _highAssetTurnoutThreshold;
        }
        if(_state.fAssetFtsos.length != _fAssetFtsos.length) {            
            _state.fAssetFtsos = _fAssetFtsos;
            _state.changed = true;        
        } else {
            for(uint i = 0; i < _fAssetFtsos.length; i++) {
                if(_state.fAssetFtsos[i] != _fAssetFtsos[i]) {
                    _state.changed = true;
                    _state.fAssetFtsos[i] = _fAssetFtsos[i];
                }
            }
        }
        _state.initialized = true;
    }
}
