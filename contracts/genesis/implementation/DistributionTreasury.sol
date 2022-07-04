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
    uint256 internal constant MAX_PULL_AMOUNT_WEI = 663600000 ether;

    // Errors
    string internal constant ERR_DISTRIBUTION_ONLY = "distribution only";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_TOO_MUCH = "too much";
    string internal constant ERR_SEND_FUNDS_FAILED = "send funds failed";
    string internal constant ERR_ALREADY_SET = "already set";
    string internal constant ERR_WRONG_ADDRESS = "wrong address";
    string internal constant ERR_ADDRESS_ZERO = "address zero";

    // Storage
    address public selectedDistribution;
    address public initialDistribution;
    address public distributionToDelegators;
    uint256 public lastPullTs;


    modifier onlyDistributionToDelegators {
        require (msg.sender == selectedDistribution && msg.sender == distributionToDelegators, ERR_DISTRIBUTION_ONLY);
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
     * @notice Sets both distribution contract addresses.
     * @param _initialDistribution          Initial distribution contract address.
     * @param _distributionToDelegators     Distribution to delegators contracts address.
     */
    function setContracts(address _initialDistribution, address _distributionToDelegators) external onlyGovernance {
        require(initialDistribution == address(0) && distributionToDelegators == address(0), ERR_ALREADY_SET);
        require(_initialDistribution != address(0) && _distributionToDelegators != address(0), ERR_ADDRESS_ZERO);
        initialDistribution = _initialDistribution;
        distributionToDelegators = _distributionToDelegators;
    }

    /**
     * @notice Selects one of the two distribution contracts
     * @param _selectedDistribution         Selected distribution contract address.
     */
    function selectDistributionContract(address _selectedDistribution) external onlyGovernance {
        require(selectedDistribution == address(0), ERR_ALREADY_SET);
        require(_selectedDistribution == initialDistribution || _selectedDistribution == distributionToDelegators, 
            ERR_WRONG_ADDRESS);
        selectedDistribution = _selectedDistribution;
        if (_selectedDistribution == initialDistribution) {
            // send funds
            _sendFunds(_selectedDistribution, address(this).balance);
        }
    }

    /**
     * @notice Moves funds to the distribution contract (once per month)
     * @param _amountWei   The amount of wei to pull to distribution contract
     */
    function pullFunds(uint256 _amountWei) external onlyDistributionToDelegators {
        // this also serves as reentrancy guard, since any re-entry will happen in the same block
        require(lastPullTs + MAX_PULL_FREQUENCY_SEC <= block.timestamp, ERR_TOO_OFTEN);
        require(_amountWei <= MAX_PULL_AMOUNT_WEI, ERR_TOO_MUCH);
        lastPullTs = block.timestamp;
        _sendFunds(msg.sender, _amountWei);
    }

    function _sendFunds(address _recipient, uint256 _amountWei) internal {
        /* solhint-disable avoid-low-level-calls */
        //slither-disable-next-line arbitrary-send
        (bool success, ) = _recipient.call{value: _amountWei}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, ERR_SEND_FUNDS_FAILED);
    }
}
