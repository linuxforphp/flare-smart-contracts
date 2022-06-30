// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/GovernedAtGenesis.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../utils/implementation/SafePct.sol";

/**
 * @title InitialAirdrop
 * @notice A contract to manage the initial airdrop allocation. 
 * @notice The balance that will be added to this contract must initially be a part of circulating supply 
 **/
contract InitialAirdrop is GovernedAtGenesis, ReentrancyGuard {
    using SafeMath for uint256;
    using SafePct for uint256;

    // constants
    uint256 internal constant CLAIMED_AT_GENESIS_BIPS = 1500;
    uint256 internal constant TOTAL_BIPS = 10000;

    // storage
    address[] public airdropAccounts;
    mapping(address => uint256) public airdropAmountsWei;
    uint256 public totalInitialAirdropWei;          // Total wei to be distributed by this contract (initial airdrop)
    uint256 public initialAirdropStartTs;           // Day 0 when airdrop starts
    uint256 public latestAirdropStartTs;            // Latest day 0 when airdrop starts
    uint256 public totalTransferredAirdropWei;      // All wei already transferred
    uint256 public nextAirdropAccountIndexToTransfer;

    // Errors
    string internal constant ERR_OUT_OF_BALANCE = "balance too low";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_NOT_STARTED = "not started";
    string internal constant ERR_ARRAY_MISMATCH = "arrays lengths mismatch";
    string internal constant ERR_ALREADY_SET = "already set";
    string internal constant ERR_WRONG_START_TIMESTAMP = "wrong start timestamp";
    string internal constant ERR_ALREADY_STARTED = "already started";

    // Events
    event AccountsAdded(address[] accounts);
    event AirdropStart(uint256 initialAirdropStartTs);
    event AirdropTransferFailure(address indexed account, uint256 amountWei);

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        require (_getExpectedBalance() <= address(this).balance, ERR_OUT_OF_BALANCE);
    }

    /**
     * @dev This modifier ensures that the airdrop was already started
     */
    modifier airdropStarted {
        require (initialAirdropStartTs != 0 && initialAirdropStartTs < block.timestamp, ERR_NOT_STARTED);
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
     * @notice Method to set addresses and their respective balances in batches to this contract (initial airdrop)
     * @param _accounts         Array of adresses we are adding in batch
     * @param _balances         Array of balances to be airdropped to respective accounts
     * @dev Note that _toAddresses and _balances arrays must be of equal length
     */
    function setAirdropBalances(address[] calldata _accounts, uint256[] calldata _balances) external onlyGovernance {
        require(_accounts.length <= 1000, ERR_TOO_MANY);
        require(_accounts.length == _balances.length, ERR_ARRAY_MISMATCH);
        require (initialAirdropStartTs == 0, ERR_ALREADY_STARTED);

        if (airdropAmountsWei[_accounts[0]] > 0) return; // batch already added
        for (uint16 i = 0; i < _accounts.length; i++) {
            address airdropAccount = _accounts[i];
            uint256 airdropAmountWei = _balances[i].mulDiv(CLAIMED_AT_GENESIS_BIPS, TOTAL_BIPS);
            airdropAccounts.push(airdropAccount);
            airdropAmountsWei[airdropAccount] = airdropAmountWei;
            totalInitialAirdropWei = totalInitialAirdropWei.add(airdropAmountWei);
        }
        // We added the accounts to airdrop, emit event
        emit AccountsAdded(_accounts);
    }

    /** 
     * @notice Latest start of the initial airdrop at _latestAirdropStartTs timestamp
     * @param _latestAirdropStartTs point in time when latest start is possible
     */
    function setLatestAirdropStart(uint256 _latestAirdropStartTs) external onlyGovernance {
        require(latestAirdropStartTs == 0, ERR_ALREADY_SET);
        latestAirdropStartTs = _latestAirdropStartTs;
    }

    /** 
     * @notice Start the initial airdrop at _initialAirdropStartTs timestamp
     * @param _initialAirdropStartTs point in time when we start
     * @dev should be called immediately after all airdrop accounts and balances are set
     */
    function setAirdropStart(uint256 _initialAirdropStartTs) external onlyGovernance mustBalance {
        require(initialAirdropStartTs == 0 || initialAirdropStartTs > block.timestamp, ERR_ALREADY_STARTED);
        require(initialAirdropStartTs < _initialAirdropStartTs && _initialAirdropStartTs <= latestAirdropStartTs,
            ERR_WRONG_START_TIMESTAMP);
        initialAirdropStartTs = _initialAirdropStartTs;
        emit AirdropStart(_initialAirdropStartTs);
    }

    /**
     * @notice Method for transfering initial airdrop amounts in batches of 100
     */
    function transferAirdrop() external airdropStarted mustBalance nonReentrant {
        uint256 upperBound = Math.min(nextAirdropAccountIndexToTransfer + 100, airdropAccounts.length);
        for (uint256 i = nextAirdropAccountIndexToTransfer; i < upperBound; i++) {
            // Get the account and amount
            address account = airdropAccounts[i];
            uint256 amountWei = airdropAmountsWei[account];
            // update state
            delete airdropAmountsWei[account];
            delete airdropAccounts[i];
            // Update grand total transferred
            totalTransferredAirdropWei = totalTransferredAirdropWei.add(amountWei);
            // Send
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send
            (bool success, ) = account.call{ value: amountWei, gas: 21000 }("");
            /* solhint-enable avoid-low-level-calls */
            if (!success) {
                emit AirdropTransferFailure(account, amountWei);
            }
        }

        // Update current position
        nextAirdropAccountIndexToTransfer = upperBound;
    }

    /**
     * @notice Return the number of airdrop accounts
     */
    function airdropAccountsLength() external view returns (uint256) {
        return airdropAccounts.length;
    }

    /**
     * @notice Compute the expected balance of this contract.
     * @param _balanceExpectedWei   The computed balance expected.
     */
    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return totalInitialAirdropWei.sub(totalTransferredAirdropWei);
    }

}
