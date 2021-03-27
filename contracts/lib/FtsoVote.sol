// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library FtsoVote {

    struct State {

        // storage
        uint256 voteId;
        mapping(uint256 => Instance) instance;
        mapping(uint256 => address) sender;
    }

    struct Instance {                               // struct holding vote data
        uint128 price;                          // submitted price
        uint64 weightFlr;                       // flare weight
        uint64 weightAsset;                     // asset weight
    }

    uint256 internal constant MAX_UINT64 = 2**64 - 1;
    uint256 internal constant MAX_UINT128 = 2**128 - 1;
    uint256 internal constant MAX_UINT192 = 2**192 - 1;

    function _createInstance(
        State storage _state,
        uint256 _votePowerFlr,
        uint256 _votePowerAsset,
        uint256 _maxVotePowerFlr,
        uint256 _maxVotePowerAsset,
        uint256 _totalVotePowerFlr,
        uint256 _totalVotePowerAsset,
        uint128 _price
    ) internal returns (uint256)
    {
        uint256 voteId = _state.voteId++;
        Instance storage vote = _state.instance[voteId];
        vote.weightFlr = _getWeight(_votePowerFlr, _maxVotePowerFlr, _totalVotePowerFlr);
        vote.weightAsset = _getWeight(_votePowerAsset, _maxVotePowerAsset, _totalVotePowerAsset);
        vote.price = _price;
        _state.sender[voteId] = msg.sender;
        return voteId;
    }

    function _getWeight(uint256 votePower, uint256 maxVotePower, uint256 totalVotePower) private pure returns (uint64) {
        uint64 weight;
        if (maxVotePower <= MAX_UINT64) {
            weight = uint64(votePower);
        } else {
            assert(votePower < MAX_UINT192);
            weight = uint64((votePower * MAX_UINT64) / totalVotePower);
        }
        return weight;
    }

}
