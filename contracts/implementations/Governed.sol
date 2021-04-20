// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


contract Governed {

    address public governance;
    address public proposedGovernance;
    bool private initialised;

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

    function initialise(address _governance) public virtual {
        require(initialised == false, "initialised != false");

        initialised = true;
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
    }

    function proposeGovernance(address _governance) external onlyGovernance {
        proposedGovernance = _governance;
    }

    function claimGovernance() external {
        require(msg.sender == proposedGovernance, "not claimaint");

        emit GovernanceUpdated(governance, proposedGovernance);
        governance = proposedGovernance;
    }
}
