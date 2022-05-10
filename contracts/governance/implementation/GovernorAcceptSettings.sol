// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIGovernorAccept.sol";
import "./Governed.sol";

abstract contract GovernorAcceptSettings is IIGovernorAccept, Governed {

    uint256 private acceptanceThresholdBIPS;
    
    event AcceptanceThresholdSet(uint256 oldAcceptanceThreshold, uint256 newAcceptanceThreshold);

    /**
     * @notice Initializes the governor parameters
     * @param _acceptanceThresholdBIPS  Percentage in BIPS of the total vote power required to accept a proposal
     */
    constructor(
        uint256 _acceptanceThresholdBIPS
    ) {
        _setAcceptanceThreshold(_acceptanceThresholdBIPS);
    }

    /**
     * @notice Updates the acceptance threshold
     * @param _acceptanceThresholdBIPS  Percentage in BIPS of the total vote power required to accept a proposal
     * @notice This operation can only be performed through a governance proposal
     * @notice Emits an AcceptanceThresholdSet event
     */
    function setAcceptanceThreshold(uint256 _acceptanceThresholdBIPS) public onlyGovernance {
        _setAcceptanceThreshold(_acceptanceThresholdBIPS);
    }

    /**
     * @notice Returns acceptance threshold
     * @return Percentage in BIPS of the vote power required to accept a proposal
     */
    function acceptanceThreshold() public view override returns (uint256) {
        return acceptanceThresholdBIPS;
    }

    /**
     * @notice Sets acceptance threshold
     * @param _acceptanceThresholdBIPS  Percentage in BIPS of the total vote power required to accept a proposal
     * @notice Emits an AcceptanceThresholdSet event
     */
    function _setAcceptanceThreshold(uint256 _acceptanceThresholdBIPS) internal {
        emit AcceptanceThresholdSet(acceptanceThresholdBIPS, _acceptanceThresholdBIPS);
        acceptanceThresholdBIPS = _acceptanceThresholdBIPS;
    }

}
