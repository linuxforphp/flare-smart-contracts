// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
contract Governed {

    address public governance;
    address public proposedGovernance;
    bool private initialised;

    event GovernanceProposed(address proposedGovernance);
    event GovernanceUpdated (address oldGovernance, address newGoveranance);

    modifier onlyGovernance () {
        require (msg.sender == governance, "only governance");
        _;
    }

    constructor(address _governance) {
        if (_governance != address(0)) {
            initialise(_governance);
        }
    }

    function proposeGovernance(address _governance) external onlyGovernance {
        proposedGovernance = _governance;
        emit GovernanceProposed(_governance);
    }

    function claimGovernance() external {
        require(msg.sender == proposedGovernance, "not claimaint");

        emit GovernanceUpdated(governance, proposedGovernance);
        governance = proposedGovernance;
        proposedGovernance = address(0);
    }

    function transferGovernance(address _governance) external onlyGovernance {
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
        proposedGovernance = address(0);
    }

    function initialise(address _governance) public virtual {
        require(initialised == false, "initialised != false");

        initialised = true;
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
        proposedGovernance = address(0);
    }
}
