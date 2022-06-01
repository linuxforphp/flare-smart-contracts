// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIGovernor.sol";
import "./Governed.sol";

abstract contract GovernorSettings is IIGovernor, Governed {

    uint256 private proposalThresholdBIPS;
    uint256 private votePowerBlockPeriodBlocks;
    uint256 private votingDelaySeconds;
    uint256 private votingPeriodSeconds;
    uint256 private executionDelaySeconds;
    uint256 private executionPeriodSeconds;
    uint256 private votePowerLifeTimeDays;
    uint256 private vpBlockPeriodSeconds;
    uint256 private wrappingThresholdBIPS;
    uint256 private absoluteThresholdBIPS;
    uint256 private relativeThresholdBIPS;

    event ProposalThresholdSet(uint256 oldProposalThreshold, uint256 newProposalThreshold);
    event VotingDelaySet(uint256 oldVotingDelay, uint256 newVotingDelay);
    event VotingPeriodSet(uint256 oldVotingPeriod, uint256 newVotingPeriod);
    event ExecutionDelaySet(uint256 oldExecutionDelay, uint256 newExecutionDelay);
    event ExecutionPeriodSet(uint256 oldExecutionPeriod, uint256 newExecutionPeriod);
    event VotePowerLifeTimeDaysSet(uint256 oldVotePowerLifeTimeDays, uint256 newVotePowerLifeTimeDays);
    event VpBlockPeriodSecondsSet(uint256 oldVpBlockPeriodSeconds, uint256 newVpBlockPeriodSeconds);
    event WrappingThresholdSet(uint256 oldWrappingThreshold, uint256 newWrappingThreshold);
    event AbsoluteThresholdSet(uint256 oldAbsoluteThreshold, uint256 newAbsoluteThreshold);
    event RelativeThresholdSet(uint256 oldRelativeThreshold, uint256 newRelativeThreshold);
 

    /**
     * @notice Initializes the governor parameters
     * @param _governance                   Address of the governance contract
     * @param _proposalThresholdBIPS        Percentage in BIPS of the total vote power required to submit a proposal
     * @param _votingDelaySeconds           Voting delay in seconds
     * @param _votingPeriodSeconds          Voting period in seconds
     * @param _executionDelaySeconds        Execution delay in seconds
     * @param _executionPeriodSeconds       Execution period in seconds
     * @param _votePowerLifeTimeDays        Period in days after which checkpoint can be deleted
     * @param _vpBlockPeriodSeconds         Minimal length of the period (in seconds) from which the
     *                                      vote power block is randomly chosen
     * @param _wrappingThresholdBIPS        Percentage in BIPS of the min wrapped supply given total circulating supply
     * @param _absoluteThresholdBIPS        Percentage in BIPS of the total vote power required for proposal "quorum"
     * @param _relativeThresholdBIPS        Percentage in BIPS of the proper relation between FOR and AGAINST votes
     */
    constructor(
        address _governance,
        uint256 _proposalThresholdBIPS,
        uint256 _votingDelaySeconds,        
        uint256 _votingPeriodSeconds,
        uint256 _executionDelaySeconds,
        uint256 _executionPeriodSeconds,
        uint256 _votePowerLifeTimeDays,
        uint256 _vpBlockPeriodSeconds,
        uint256 _wrappingThresholdBIPS,
        uint256 _absoluteThresholdBIPS,
        uint256 _relativeThresholdBIPS
    ) Governed(_governance) {
        _setProposalThreshold(_proposalThresholdBIPS);
        _setVotingDelay(_votingDelaySeconds);
        _setVotingPeriod(_votingPeriodSeconds);
        _setExecutionDelay(_executionDelaySeconds);
        _setExecutionPeriod(_executionPeriodSeconds);
        _setVotePowerLifeTimeDays(_votePowerLifeTimeDays);
        _setVpBlockPeriodSeconds(_vpBlockPeriodSeconds);
        _setWrappingThreshold(_wrappingThresholdBIPS);
        _setAbsoluteThreshold(_absoluteThresholdBIPS);
        _setRelativeThreshold(_relativeThresholdBIPS);
    }

    /**
     * @notice Updates the proposal threshold
     * @param _proposalThresholdBIPS    Percentage in BIPS of the total vote power required to submit a proposal
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a ProposalThresholdSet event.
     */
    function setProposalThreshold(uint256 _proposalThresholdBIPS) public onlyGovernance {
        _setProposalThreshold(_proposalThresholdBIPS);
    }

    /**
     * @notice Updates the voting delay
     * @param _votingDelaySeconds       Voting delay in seconds
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a VotingDelaySet event
     */
    function setVotingDelay(uint256 _votingDelaySeconds) public onlyGovernance {
        _setVotingDelay(_votingDelaySeconds);
    }

    /**
     * @notice Updates the voting period
     * @param _votingPeriodSeconds      Voting period in seconds
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a VotingPeriodSet event.
     */
    function setVotingPeriod(uint256 _votingPeriodSeconds) public onlyGovernance {
        _setVotingPeriod(_votingPeriodSeconds);
    }

    /**
     * @notice Updates the execution delay
     * @param _executionDelaySeconds    Execution delay in seconds
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits an ExecutionDelaySet event
     */
    function setExecutionDelay(uint256 _executionDelaySeconds) public onlyGovernance {
        _setExecutionDelay(_executionDelaySeconds);
    }

    /**
     * @notice Updates the execution period
     * @param _executionPeriodSeconds   Execution period in seconds
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits an ExecutionPeriodSet event.
     */
    function setExecutionPeriod(uint256 _executionPeriodSeconds) public onlyGovernance {
        _setExecutionPeriod(_executionPeriodSeconds);
    }

    /**
     * @notice Updates the vote power life time days
     * @param _votePowerLifeTimeDays      Time in days from the time vote power checkpoint 
     was created to the time that the checkpoint can be deleted
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a VotePowerLifeTimeDaysSet event
     */
    function setVotePowerLifeTimeDays(uint256 _votePowerLifeTimeDays) public onlyGovernance {
        _setVotePowerLifeTimeDays(_votePowerLifeTimeDays);
    }

    /**
     * @notice Updates the vote power block period
     * @param _vpBlockPeriodSeconds     Minimal length of period in seconds from which the vote power
     block is randomly chosen
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a VpBlockPeriodSecondsSet event
     */
    function setVpBlockPeriodSeconds(uint256 _vpBlockPeriodSeconds) public onlyGovernance {
        _setVpBlockPeriodSeconds(_vpBlockPeriodSeconds);
    }

    /**
     * @notice Updates wrapping threshold
     * @param _wrappingThresholdBIPS    Percentage in BIPS of the min wrapped supply given total circulating supply
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a WrappingThresholdSet event
     */
    function setWrappingThreshold(uint256 _wrappingThresholdBIPS) public onlyGovernance {
        _setWrappingThreshold(_wrappingThresholdBIPS);
    }

    /**
     * @notice Updates absolute threshold
     * @param _absoluteThresholdBIPS    Percentage in BIPS of the total vote power required for proposal "quorum"
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits an AbsoluteThresholdSet event
     */
    function setAbsoluteThreshold(uint256 _absoluteThresholdBIPS) public onlyGovernance {
        _setAbsoluteThreshold(_absoluteThresholdBIPS);
    }

    /**
     * @notice Updates relative threshold
     * @param _relativeThresholdBIPS    Percentage in BIPS of the proper relation between FOR and AGAINST votes
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a RelativeThresholdSet event
     */
    function setRelativeThreshold(uint256 _relativeThresholdBIPS) public onlyGovernance {
        _setRelativeThreshold(_relativeThresholdBIPS);
    }

    /**
     * @notice Returns proposal threshold
     * @return Percentage in BIPS of the total vote power required to submit a proposal
     */
    function proposalThreshold() public view override returns (uint256) {
        return proposalThresholdBIPS;
    }

    /**
     * @notice Returns the voting delay in seconds
     * @return Seconds between proposal submission and voting start
     */
    function votingDelay() public view override returns (uint256) {
        return votingDelaySeconds;
    }

    /**
     * @notice Returns the voting period in seconds
     * @return Voting time in seconds
     */
    function votingPeriod() public view override returns (uint256) {
        return votingPeriodSeconds;
    }

    /**
     * @notice Returns the execution delay in seconds
     * @return Seconds between voting end and execution start
     */
    function executionDelay() public view override returns (uint256) {
        return executionDelaySeconds;
    }

    /**
     * @notice Returns the execution period in seconds
     * @return Execution time in seconds
     */
    function executionPeriod() public view override returns (uint256) {
        return executionPeriodSeconds;
    }

    /** 
     * @notice Returns vote power life time days
     * @return Period in days after which checkpoint can be deleted
     */
    function getVotePowerLifeTimeDays() public view override returns (uint256) {
        return votePowerLifeTimeDays;
    }

    /** 
     * @notice Returns vote power period (in seconds) from which the vote power block is randomly chosen
     * @return Minimal period length
     */
    function getVpBlockPeriodSeconds() public view override returns (uint256) {
        return vpBlockPeriodSeconds;
    }

    /**
     * @notice Returns quorum threshold
     * @return Percentage in BIPS of the min wrapped supply given total circulating supply
     */
    function wrappingThreshold() public view override returns (uint256) {
        return wrappingThresholdBIPS;
    }

    /**
     * @notice Returns quorum threshold
     * @return Percentage in BIPS of the total vote power required for proposal "quorum"
     */
    function absoluteThreshold() public view override returns (uint256) {
        return absoluteThresholdBIPS;
    }

    /**
     * @notice Returns quorum threshold
     * @return Percentage in BIPS of the proper relation between FOR and AGAINST votes
     */
    function relativeThreshold() public view override returns (uint256) {
        return relativeThresholdBIPS;
    }

    /**
     * @notice Sets proposal threshold
     * @param _proposalThresholdBIPS    Percentage in BIPS of the total vote power required to submit a proposal
     * @notice Emits a ProposalThresholdSet event
     */
    function _setProposalThreshold(uint256 _proposalThresholdBIPS) internal {
        emit ProposalThresholdSet(proposalThresholdBIPS, _proposalThresholdBIPS);
        proposalThresholdBIPS = _proposalThresholdBIPS;
    }

    /**
     * @notice Sets voting delay
     * @param _votingDelaySeconds       Voting delay in seconds
     * @notice Emits a VotingDelaySet event
     */
    function _setVotingDelay(uint256 _votingDelaySeconds) internal {
        emit VotingDelaySet(votingDelaySeconds, _votingDelaySeconds);
        votingDelaySeconds = _votingDelaySeconds;
    }

    /**
     * @notice Sets voting period
     * @param _votingPeriodSeconds      Voting period in seconds
     * @notice Emits a VotingPeriodSet event
     */
    function _setVotingPeriod(uint256 _votingPeriodSeconds) internal {
        // voting period must be at least one second long
        require(_votingPeriodSeconds > 0, "voting period too low");
        emit VotingPeriodSet(votingPeriodSeconds, _votingPeriodSeconds);
        votingPeriodSeconds = _votingPeriodSeconds;
    }

    /**
     * @notice Sets execution delay
     * @param _executionDelaySeconds    Execution delay in seconds
     * @notice Emits an ExecutionDelaySet event
     */
    function _setExecutionDelay(uint256 _executionDelaySeconds) internal {
        emit ExecutionDelaySet(executionDelaySeconds, _executionDelaySeconds);
        executionDelaySeconds = _executionDelaySeconds;
    }

    /**
     * @notice Sets execution period
     * @param _executionPeriodSeconds   Execution period in seconds
     * @notice Emits an ExecutionPeriodSet event
     */
    function _setExecutionPeriod(uint256 _executionPeriodSeconds) internal {
        // execution period must be at least one second long
        require(_executionPeriodSeconds > 0, "execution period too low");
        emit ExecutionPeriodSet(executionPeriodSeconds, _executionPeriodSeconds);
        executionPeriodSeconds = _executionPeriodSeconds;
    }

    /**
     * @notice Sets the vote power life time days
     * @param _votePowerLifeTimeDays      Time in days from the time vote power checkpoint 
     was created to the time that the checkpoint can be deleted
     * @notice Emits a VotePowerLifeTimeDaysSet event
     */
    function _setVotePowerLifeTimeDays(uint256 _votePowerLifeTimeDays) internal {
        emit VotePowerLifeTimeDaysSet(votePowerLifeTimeDays, _votePowerLifeTimeDays);
        votePowerLifeTimeDays = _votePowerLifeTimeDays;
    }

    /**
     * @notice Sets the vote power block period
     * @param _vpBlockPeriodSeconds      Minimal length of period in seconds from which the vote power 
     block is randomly chosen
     * @notice Emits a VpBlockPeriodSecondsSet event
     */
    function _setVpBlockPeriodSeconds(uint256 _vpBlockPeriodSeconds) internal {
        emit VpBlockPeriodSecondsSet(vpBlockPeriodSeconds, _vpBlockPeriodSeconds);
        vpBlockPeriodSeconds = _vpBlockPeriodSeconds;
    }

    /**
     * @notice Sets wrapping threshold
     * @param _wrappingThresholdBIPS    Percentage in BIPS of the min wrapped supply given total circulating supply
     * @notice Emits a WrappingThresholdSet event
     */
    function _setWrappingThreshold(uint256 _wrappingThresholdBIPS) internal {
        emit WrappingThresholdSet(wrappingThresholdBIPS, _wrappingThresholdBIPS);
        wrappingThresholdBIPS = _wrappingThresholdBIPS;
    }

    /**
     * @notice Sets absolute threshold
     * @param _absoluteThresholdBIPS    Percentage in BIPS of the total vote power required for proposal "quorum"
     * @notice Emits an AbsoluteThresholdSet event
     */
    function _setAbsoluteThreshold(uint256 _absoluteThresholdBIPS) internal {
        emit AbsoluteThresholdSet(absoluteThresholdBIPS, _absoluteThresholdBIPS);
        absoluteThresholdBIPS = _absoluteThresholdBIPS;
    }

    /**
     * @notice Sets relative threshold
     * @param _relativeThresholdBIPS    Percentage in BIPS of the proper relation between FOR and AGAINST votes
     * @notice Emits a RelativeThresholdSet event
     */
    function _setRelativeThreshold(uint256 _relativeThresholdBIPS) internal {
        require(_relativeThresholdBIPS >= 5000, "invalid _relativeThresholdBIPS");
        emit RelativeThresholdSet(relativeThresholdBIPS, _relativeThresholdBIPS);
        relativeThresholdBIPS = _relativeThresholdBIPS;
    }
}
