// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

abstract contract GovernorVotes {

    /**
     * @notice Enum that determines vote (support) type
     * @dev 0 = Against, 1 = For, 2 = Abstain
     */
    enum VoteType {
        Against,
        For,
        Abstain
    }

    /**
     * @notice Struct holding the information about proposal voting
     */
    struct ProposalVoting {
        uint256 abstainVotePower;           // accumulated vote power abstained from voting
        uint256 againstVotePower;           // accumulated vote power against the proposal
        uint256 forVotePower;               // accumulated vote power for the proposal        
        mapping(address => bool) hasVoted;  // flag if a voter has cast a vote
    }
    
    mapping(uint256 => ProposalVoting) internal proposalVotings;

    /**
     * @notice Stores a proposal vote
     * @param _proposalId           Id of the proposal
     * @param _voter                Address of the voter
     * @param _support              Parameter indicating the vote type
     * @param _votePower            Vote power of the voter
     */
    function _storeVote(
        uint256 _proposalId,
        address _voter,
        uint8 _support,
        uint256 _votePower
    ) internal {
        ProposalVoting storage voting = proposalVotings[_proposalId];

        require(!voting.hasVoted[_voter], "vote already cast");
        voting.hasVoted[_voter] = true;

        if (_support == uint8(VoteType.Against)) {
            voting.againstVotePower += _votePower;
        } else if (_support == uint8(VoteType.For)) {
            voting.forVotePower += _votePower;
        } else if (_support == uint8(VoteType.Abstain)) {
            voting.abstainVotePower += _votePower;
        } else {
            revert("invalid value for enum VoteType");
        }
    }

}
