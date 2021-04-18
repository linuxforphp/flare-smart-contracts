// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title A library used for FTSO vote management
 * @dev Every vote corresponds to a specific FTSO epoch
 */
library FtsoVote {

    struct State {                              // struct holding storage related to votes

        // storage
        uint256 voteId;                         // vote id counter
        mapping(uint256 => Instance) instance;  // mapping from vote id to instance
        mapping(uint256 => address) sender;     // mapping from vote id to vote sender address
    }

    struct Instance {                           // struct holding vote data

        uint128 price;                          // submitted price in USD
        uint64 weightFlr;                       // FLR weight
        uint64 weightAsset;                     // asset weight
    }

    uint256 internal constant MAX_UINT64 = 2**64 - 1;

    /**
     * @notice Creates a vote instance and stores data associated with the vote
     * @param _state                Vote state
     * @param _votePowerFlr         FLR Vote power 
     * @param _votePowerAsset       Asset vote power
     * @param _maxVotePowerFlr      Max FLR vote power acceptable in epoch
     * @param _maxVotePowerAsset    Max asset vote power acceptable in epoch
     * @param _totalVotePowerFlr    Total FLR vote power in epoch
     * @param _totalVotePowerAsset  Total asset vote power in epoch
     * @param _price                Price in USD submitted in a vote
     * @return Vote id
     */
    function _createInstance(
        State storage _state,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,
        uint256 _maxVotePowerFlr,
        uint256 _maxVotePowerAsset,
        uint256 _totalVotePowerFlr,
        uint256 _totalVotePowerAsset,
        uint256 _price
    ) internal returns (uint256)
    {
        uint256 voteId = _state.voteId++;
        Instance storage vote = _state.instance[voteId];
        vote.weightFlr = _getWeight(_votePowerFlr, _maxVotePowerFlr, _totalVotePowerFlr);
        vote.weightAsset = _getWeight(_votePowerAsset, _maxVotePowerAsset, _totalVotePowerAsset);
        vote.price = uint128(_price);
        _state.sender[voteId] = msg.sender;
        return voteId;
    }

    /**
     * @notice Returns the vote weight (FLR or asset) computed based on vote power
     * @param _votePower            Vote power
     * @param _maxVotePower         Max vote power in epoch
     * @param _totalVotePower       Total vote power in epoch
     * @return Vote weight
     * @dev Vote power is adjusted to uint64
     */
    function _getWeight(
        uint256 _votePower,
        uint256 _maxVotePower,
        uint256 _totalVotePower
    ) private pure returns (uint64)
    {
        uint64 weight;
        if (_maxVotePower <= MAX_UINT64) {
            weight = uint64(_votePower);
        } else {
            weight = uint64((_votePower * MAX_UINT64) / _totalVotePower);
        }
        return weight;
    }

}
