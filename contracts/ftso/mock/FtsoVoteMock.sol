// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {FtsoVote} from "../lib/FtsoVote.sol";

/**
 * @title Ftso Vote mock contract
 * @notice A contract to expose the FtsoVote library for unit testing.
 **/
contract FtsoVoteMock {
    using FtsoVote for FtsoVote.State;
    using FtsoVote for FtsoVote.Instance;

    FtsoVote.State private state;

    function createInstance(
        address _voter,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,
        uint256 _totalVotePowerFlr,
        uint256 _totalVotePowerAsset,
        uint256 _price) public returns(uint256) {
        return state._createInstance(
            _voter,
            _votePowerFlr,
            _votePowerAsset,
            _totalVotePowerFlr,
            _totalVotePowerAsset,
            _price);
    }

    function getLastVoteId() public view returns(uint256) {
        return state.voteId;
    }

    function getLastVote() public view returns(FtsoVote.Instance memory) {
        return state.instance[state.voteId];
    }

    function getVote(uint256 voteId) public view returns(FtsoVote.Instance memory) {
        return state.instance[voteId];
    }
}
