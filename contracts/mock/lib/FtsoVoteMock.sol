// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {FtsoVote} from "../../lib/FtsoVote.sol";

/**
 * @title Ftso Vote mock contract
 * @notice A contract to expose the FtsoVote library for unit testing.
 **/
contract FtsoVoteMock {
    using FtsoVote for FtsoVote.State;
    using FtsoVote for FtsoVote.Instance;

    FtsoVote.State private _state;

    function _createInstance(
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,
        uint256 _maxVotePowerFlr,
        uint256 _maxVotePowerAsset,
        uint256 _totalVotePowerFlr,
        uint256 _totalVotePowerAsset,
        uint256 _price) public returns(uint256) {
        return _state._createInstance(
            _votePowerFlr, 
            _votePowerAsset, 
            _maxVotePowerFlr, 
            _maxVotePowerAsset, 
            _totalVotePowerFlr, 
            _totalVotePowerAsset, 
            _price);
    }

    function getLastVoteId() public view returns(uint256) {
        return _state.voteId-1;
    }

    function getLastVote() public view returns(FtsoVote.Instance memory) {
        return _state.instance[_state.voteId-1];
    }

    function getVote(uint256 voteId) public view returns(FtsoVote.Instance memory) {
        return _state.instance[voteId];
    }
}