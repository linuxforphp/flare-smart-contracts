// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

interface IIGovernorAccept {

    /**
     * @notice Struct holding the information about proposal settings
     */
    struct ProposalSettings {
        uint256 quorumThreshold;         // percentage in BIPS of the total vote power required for proposal quorum
        uint256 acceptanceThreshold;    // percentage in BIPS of the total vote power required to accept a proposal
    }

    /**
     * @notice Event emitted when a proposal is created
     */
    event ProposalSettingsAccept(
        uint256 proposalId,
        uint256 votePowerBlock,
        uint256 quorumThreshold,
        uint256 acceptanceThreshold
    );

    /**
     * @notice Returns acceptance threshold
     * @return Percentage in BIPS of the vote power required to accept a proposal
     */
    function acceptanceThreshold() external view returns (uint256);

}
