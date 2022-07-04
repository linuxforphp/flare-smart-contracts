// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./Governor.sol";
import "../../utils/implementation/SafePct.sol";

contract PollingAccept is Governor {

    using SafePct for uint256;

    /**
     * @notice Initializes the contract with default parameters
     * @param _governance                   Address identifying the governance address
     * @param _priceSubmitter               Address identifying the price submitter contract
     * @param _addressUpdater               Address identifying the address updater contract
     * @param _proposalSettings             Array of proposal settings in the following order
     *          proposalThresholdBIPS       Percentage in BIPS of the total vote power required to submit a proposal
     *          votingDelaySeconds          Voting delay in seconds
     *          votingPeriodSeconds         Voting period in seconds
     *          executionDelaySeconds       Execution delay in seconds
     *          executionPeriodSeconds      Execution period in seconds
     *          votePowerLifeTimeDays       Number of days after which checkpoint can be deleted
     *          vpBlockPeriodSeconds        Minimal length of the period (in seconds) from which the
     *                                      vote power block is randomly chosen
     *          wrappingThresholdBIPS       Percentage in BIPS of the min wrapped supply given total circulating supply
     *          absoluteThresholdBIPS       Percentage in BIPS of the total vote power required for proposal "quorum"
     *          relativeThresholdBIPS       Percentage in BIPS of the proper relation between FOR and AGAINST votes
     */
    constructor(
        uint256[] memory _proposalSettings,
        address _governance,
        address _priceSubmitter,
        address _addressUpdater
    )
        Governor(
            _proposalSettings,
            _governance,
            _priceSubmitter,
            _addressUpdater
        )
    {}

    /**
     * @notice Determines if the submitter of a proposal is a valid proposer
     * @param _proposer             Address of the submitter
     * @param _votePowerBlock       Number representing the vote power block for which the validity is checked
     * @return True if the submitter is valid, and false otherwise
     */
    function _isValidProposer(address _proposer, uint256 _votePowerBlock) internal view override returns (bool) {
        return _hasVotePowerToPropose(_proposer, _votePowerBlock);
    }

    /**
     * @notice Determines if a proposal has been successful
     * @param _proposalId           Id of the proposal
     * @param _proposal             Proposal
     * @return True if proposal succeeded and false otherwise
     */
    function _proposalSucceeded(uint256 _proposalId, Proposal storage _proposal) internal view override returns (bool){
        ProposalVoting storage voting = proposalVotings[_proposalId];

        if (voting.forVotePower < _proposal.absoluteThreshold.mulDiv(_proposal.totalVP, MAX_BIPS)) {
            return false;
        }

        if (voting.forVotePower <= 
            _proposal.relativeThreshold.mulDiv(voting.forVotePower + voting.againstVotePower, MAX_BIPS)) {
            return false;
        }

        return true;
    }

    /**
     * @notice Returns the name of the governor contract
     * @return String representing the name
     */
    function _name() internal pure override returns (string memory) {
        return "PollingAccept";
    }

    /**
     * @notice Returns the version of the governor contract
     * @return String representing the version
     */
    function _version() internal pure override returns (string memory) {
        return "1";
    }

}
