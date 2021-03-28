// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


contract Governed {

    address public governance;
    address public proposedGovernance;

    event GovernanceUdpated (address oldGovernance, address newGoveranance);

    modifier onlyGovernance () {
        require (msg.sender == governance, "only governance");
        _;
    }

    constructor(address _governance) {
        governance = _governance;
    }

    function proposeGovernance(address _governance) external onlyGovernance {
        proposedGovernance = _governance;
    }

    function claimGovernance() external {
        require(msg.sender == proposedGovernance, "invalid address");

        emit GovernanceUdpated(governance, proposedGovernance);
        governance = proposedGovernance;
    }
}
