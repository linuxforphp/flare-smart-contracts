// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIGovernorReject.sol";
import "./Governed.sol";

abstract contract GovernorRejectSettings is IIGovernorReject, Governed {

    uint256 private rejectionThresholdBIPS;
    mapping(address => bool) private proposers;

    event RejectionThresholdSet(uint256 oldRejectionThreshold, uint256 newRejectionThreshold);
    event ProposersChanged(address[] addedProposers, address[] removedProposers);

    /**
     * @notice Initializes the governor parameters
     * @param _rejectionThresholdBIPS   Percentage in BIPS of the total vote power required to reject a proposal
     * @param _proposers                Array of addresses allowed to submit a proposal
     */
    constructor(
        uint256 _rejectionThresholdBIPS,
        address[] memory _proposers
    ) {
        _setRejectionThreshold(_rejectionThresholdBIPS);
        _changeProposers(_proposers, new address[](0));
    }
    
    /**
     * @notice Updates the rejection threshold
     * @param _rejectionThresholdBIPS   Percentage in BIPS of the total vote power required to reject a proposal
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a RejectionThresholdSet event
     */
    function setRejectionThreshold(uint256 _rejectionThresholdBIPS) public onlyGovernance {
        _setRejectionThreshold(_rejectionThresholdBIPS);
    }

    /**
     * @notice Changes proposers
     * @param _proposersToAdd       Array of addresses to make eligible to submit a proposal
     * @param _proposersToRemove    Array of addresses to make ineligible to submit a proposal
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits a ProposersChanged event
     */
    function changeProposers(
        address[] memory _proposersToAdd,
        address[] memory _proposersToRemove
    ) public onlyGovernance {
        _changeProposers(_proposersToAdd, _proposersToRemove);
    }

    /**
     * @notice Returns rejection threshold
     * @return Percentage in BIPS of the vote power required to reject a proposal
     */
    function rejectionThreshold() public view override returns (uint256) {
        return rejectionThresholdBIPS;
    }

    /**
     * @notice Determines if account is eligible to submit a proposal
     * @param _account              Address of the queried account
     * @return True if account is eligible for proposal submission, and false otherwise
     */
    function isProposer(address _account) public view override returns (bool) {
        return proposers[_account];
    }

    /**
     * @notice Sets rejection threshold
     * @param _rejectionThresholdBIPS   Percentage in BIPS of the total vote power required to reject a proposal
     * @notice Emits a RejectionThresholdSet event
     */
    function _setRejectionThreshold(uint256 _rejectionThresholdBIPS) internal {
        emit RejectionThresholdSet(rejectionThresholdBIPS, _rejectionThresholdBIPS);
        rejectionThresholdBIPS = _rejectionThresholdBIPS;
    }

    /**
     * @notice Changes proposers
     * @param _proposersToAdd       Array of addresses to make eligible to submit a proposal
     * @param _proposersToRemove    Array of addresses to make ineligible to submit a proposal
     * @notice Emits a ProposersChanged event
     */
    function _changeProposers(address[] memory _proposersToAdd, address[] memory _proposersToRemove) internal {
        emit ProposersChanged(_proposersToAdd, _proposersToRemove);
        for (uint256 i = 0; i < _proposersToAdd.length; i++) {
            proposers[_proposersToAdd[i]] = true;
        }
        for (uint256 i = 0; i < _proposersToRemove.length; i++) {
            proposers[_proposersToRemove[i]] = false;
        }
    }

}
