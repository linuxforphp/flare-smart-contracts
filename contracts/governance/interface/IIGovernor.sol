// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../userInterfaces/IGovernor.sol";

interface IIGovernor is IGovernor {

    /**
     * @notice Returns proposal threshold
     * @return Vote power required to submit a proposal
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function proposalThreshold() external view returns (uint256);

    /**
     * @notice Returns the voting delay in seconds
     * @return Seconds between proposal submission and voting start
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     * @dev Violates compatibility with Tally (delay is measured in seconds not number of blocks)
     */
    function votingDelay() external view returns (uint256);

    /**
     * @notice Returns the voting period in seconds
     * @return Voting time in seconds
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     * @dev Violates compatibility with Tally (period is measured in seconds not number of blocks)
     */
    function votingPeriod() external view returns (uint256);

    /**
     * @notice Returns the execution delay in seconds
     * @return Seconds between voting end and execution start
     */
    function executionDelay() external view returns (uint256);

    /**
     * @notice Returns the execution period in seconds
     * @return Execution time in seconds
     */
    function executionPeriod() external view returns (uint256);


    /**
     * @notice Returns vote power life time days
     * @return Period in days after which checkpoint can be deleted
     */
    function getVotePowerLifeTimeDays() external view returns (uint256);

    /** 
     * @notice Returns minimal length of period (in seconds) from which the vote power block is randomly chosen
     * @return Minimal period length
     */
    function getVpBlockPeriodSeconds() external view returns (uint256);

    /**
     * @notice Returns wrapping threshold
     * @return Percentage in BIPS of the min wrapped supply given total circulating supply
     */
    function wrappingThreshold() external view returns (uint256);

    /**
     * @notice Returns absolute threshold
     * @return Percentage in BIPS of the total vote power required for proposal "quorum"
     */
    function absoluteThreshold() external view returns (uint256);

    /**
     * @notice Returns relative threshold
     * @return Percentage in BIPS of the proper relation between FOR and AGAINST votes
     */
    function relativeThreshold() external view returns (uint256);
}
