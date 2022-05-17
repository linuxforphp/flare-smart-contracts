// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/GovernedAtGenesis.sol";


/**
 * @title Distribution treasury
 * @notice A genesis contract used to hold funds until the distribution plan is chosen.
 */
contract DistributionTreasury is GovernedAtGenesis {

    // How often can distribution pull funds - 29 days constant
    uint256 internal constant MAX_PULL_FREQUENCY_SEC = 29 days;

    // Errors
    string internal constant ERR_DISTRIBUTION_ONLY = "distribution only";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_TOO_MUCH = "too much";
    string internal constant ERR_PULL_FAILED = "pull failed";

    // Storage
    address public distribution;
    uint256 public maxPullAmountWei;
    uint256 public lastPullTs;


    modifier onlyDistribution {
        require (msg.sender == distribution, ERR_DISTRIBUTION_ONLY);
        _;
    }

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructor is called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) {
        /* empty block */
    }

    /**
     * @notice Sets the distribution contract address.
     * @param _distribution         The chosen distribution implementation contract.
     * @param _maxPullAmountWei     The max amount of wei to pull to distribution contract per call
     */
    function setDistributionContract(address _distribution, uint256 _maxPullAmountWei) external onlyGovernance {
        distribution = _distribution;
        maxPullAmountWei = _maxPullAmountWei;
    }

    /**
     * @notice Moves funds to the distribution contract (once per month)
     * @param _amountWei   The amount of wei to pull to distribution contract
     */
    function pullFunds(uint256 _amountWei) external onlyDistribution {
        // this also serves as reentrancy guard, since any re-entry will happen in the same block
        require(lastPullTs + MAX_PULL_FREQUENCY_SEC <= block.timestamp, ERR_TOO_OFTEN);
        require(_amountWei <= maxPullAmountWei, ERR_TOO_MUCH);
        lastPullTs = block.timestamp;
        /* solhint-disable avoid-low-level-calls */
        //slither-disable-next-line arbitrary-send
        (bool success, ) = msg.sender.call{value: _amountWei}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, ERR_PULL_FAILED);
    }
}
