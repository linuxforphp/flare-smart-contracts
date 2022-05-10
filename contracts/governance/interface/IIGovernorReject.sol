// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

interface IIGovernorReject {

    /**
     * @notice Struct holding the information about proposal settings
     */
    struct ProposalSettings {
        uint256 quorumThreshold;        // percentage in BIPS of the total vote power required for proposal quorum
        uint256 rejectionThreshold;     // percentage in BIPS of the total vote power required to reject a proposal
    }

    /**
     * @notice Event emitted when a proposal is created
     */
    event ProposalSettingsReject(
        uint256 proposalId,
        uint256 votePowerBlock,
        uint256 quorumThreshold,
        uint256 rejectionThreshold
    );

    /**
     * @notice Returns rejection threshold
     * @return Percentage in BIPS of the vote power required to reject a proposal
     */
    function rejectionThreshold() external view returns (uint256);

    /**
     * @notice Determines if account is eligible to submit a proposal
     * @param _account              Address of the queried account
     * @return True if account is eligible for proposal submission, and false otherwise
     */
    function isProposer(address _account) external view returns (bool);

}
