// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/GovernedAtGenesis.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "../../utils/implementation/SafePct.sol";
import "../../userInterfaces/IDistribution.sol";


/**
 * @title Distribution
 * @notice A contract to manage the ongoing airdrop distribution after the genesis allocation. 
 * The remaining ammount is distributed by this contract, with a set rate every 30 days
 **/
contract Distribution is GovernedAtGenesis, IDistribution {
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SafePct for uint256;

    // Airdrop Account stuct (for memory)
    struct AirdropAccount {
        uint256 entitlementBalanceWei;            // 100% of entitled airdrop in Wei
        uint256 totalClaimedWei;                  // already claimed Wei
        uint256 optOutBalanceWei;                 // The balance that accounts is opting out (per account)
        uint256 airdroppedAtGenesisWei;           // Amount airdropped at genesis (initial airdrop amount)
        // HealthChecks:
        // * entitlementBalanceWei >= totalClaimedWei 
        // * entitlementBalanceWei == totalClaimedWei + optOutBalanceWei if optOutBalanceWei > 0
        // * entitlementBalanceWei == totalClaimedWei at some point in the future
    }

    // constants
    uint256 internal constant MONTH = 30 days;
    uint256 internal constant MAX_ADDRESS_BATCH_SIZE = 1000;
    uint256 internal constant TOTAL_BIPS = 10000;
    uint256 internal constant CLAIMED_AT_GENESIS_BIPS = 1500;
    uint256 internal constant TOTAL_CLAIMABLE_BIPS = 8500;
    uint256 internal constant MONTHLY_CLAIMABLE_BIPS = 300;  // 3% every 30 days

    // storage
    mapping(address => AirdropAccount) public airdropAccounts;
    uint256 public totalEntitlementWei;   // Total wei to be distributed by this contract (all but initial airdrop)
    uint256 public totalClaimedWei;       // All wei already claimed
    uint256 public totalOptOutWei;        // The total opt-out Wei of all accounts that opt-out
    uint256 public withdrawnOptOutWei;    // Amount of opt-out Wei that was withdrawn by governance
    uint256 public entitlementStartTs;    // Day 0 when contract starts

    // Errors
    string internal constant ERR_OUT_OF_BALANCE = "balance too low";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_NOT_ZERO = "not zero";
    string internal constant ERR_ALREADY_REGISTERED = "already registered";
    string internal constant ERR_NOT_REGISTERED = "not registered";
    string internal constant ERR_NOT_STARTED = "not started";
    string internal constant ERR_FULLY_CLAIMED = "already fully claimed";
    string internal constant ERR_OPT_OUT = "already opted out";
    string internal constant ERR_NO_BALANCE_CLAIMABLE = "no balance currently available";
    string internal constant ERR_ARRAY_MISMATCH = "arrays lengths mismatch";

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        require (_getExpectedBalance() <= address(this).balance, ERR_OUT_OF_BALANCE);
    }

    /**
     * @dev This modifier ensures that the entitelment was already started
     */
    modifier entitlementStarted {
        require (entitlementStartTs != 0 && entitlementStartTs < block.timestamp, ERR_NOT_STARTED);
        _;
    }

    /**
     * @dev Access control to protect methods to allow only minters to call select methods
     *   (like transferring balance out).
     */
    modifier accountCanClaim (address _owner) {
        require(airdropAccounts[_owner].airdroppedAtGenesisWei != 0, ERR_NOT_REGISTERED);
        require(airdropAccounts[_owner].optOutBalanceWei == 0, ERR_OPT_OUT);
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
     * @notice Method to set addresses and their respective balances in batches to this contract (airdrop)
     * @param toAddress array of adresses we are adding in batch
     * @param balance array of balances to be airdropped to respective accounts
     * @dev Note that toAddress and balance arrays must be equal length
     */
    function setClaimBalance(address[] calldata toAddress, uint256[] calldata balance) external onlyGovernance {
        require(toAddress.length <= MAX_ADDRESS_BATCH_SIZE, ERR_TOO_MANY);
        require(toAddress.length == balance.length, ERR_ARRAY_MISMATCH);
        for(uint16 i = 0; i < toAddress.length; i++) {
            // Assume that when the initial 15% was allocated, that any remainder was truncated.
            // Therefore, compute the difference to obtain the remaining entitlement balance.
            uint256 claimedAtGenesis = balance[i].mulDiv(CLAIMED_AT_GENESIS_BIPS, TOTAL_BIPS);
            uint256 entiteledWei = balance[i].sub(claimedAtGenesis);
            airdropAccounts[toAddress[i]] =
                AirdropAccount({
                    entitlementBalanceWei: entiteledWei,
                    totalClaimedWei: 0,
                    optOutBalanceWei: 0,
                    airdroppedAtGenesisWei: claimedAtGenesis
                });
            totalEntitlementWei = totalEntitlementWei.add(entiteledWei);
        }
        // We added the accounts to airdrop, emit event
        emit AccountsAdded(toAddress);
    }

    /** 
     * @notice Start the distribution contract at _entitlementStartTs timestamp
     * @dev We can start in the past, is this what we expect?
     * @param _entitlementStartTs point in time when we start
     */
    function setEntitlementStart(uint256 _entitlementStartTs) external onlyGovernance mustBalance {
        require(entitlementStartTs == 0, ERR_NOT_ZERO);
        entitlementStartTs = _entitlementStartTs;
        emit EntitlementStarted();
    }

    /**
     * @notice Method to opt-out of receiving airdrop rewards
     * @dev 
     */
    function optOutOfAirdrop() external override accountCanClaim(msg.sender) entitlementStarted {
        // you can only opt-out for your address
        AirdropAccount storage airdropAccount = airdropAccounts[msg.sender];
        require(airdropAccount.entitlementBalanceWei > airdropAccount.totalClaimedWei, ERR_FULLY_CLAIMED);
        // emit opt-out event
        emit AccountOptOut(msg.sender);
        // set all unclaimed wei to opt-out balance
        airdropAccount.optOutBalanceWei = airdropAccount.entitlementBalanceWei - airdropAccount.totalClaimedWei;
        // Add this accounts opt-out balance to full opt-out balance
        totalOptOutWei = totalOptOutWei.add(airdropAccount.optOutBalanceWei);
    }

    /**
     * @notice Method for claiming unlocked airdrop amounts
     * @return _amountWei claimed wei
     */
    function claim() external override entitlementStarted mustBalance accountCanClaim(msg.sender) 
        returns(uint256 _amountWei) 
    {
        // Get the account
        AirdropAccount storage airdropAccount = airdropAccounts[msg.sender];
        // Get the current claimable amount for the account
        _amountWei = _getCurrentClaimableWei(msg.sender);
        // Make sure we are not withdrawing 0 funds
        require(_amountWei > 0, ERR_NO_BALANCE_CLAIMABLE);
        // Update claimed balance
        airdropAccount.totalClaimedWei += _amountWei;
        // Update grand total claimed
        totalClaimedWei = totalClaimedWei.add(_amountWei);
        // Emit the claim event
        emit AccountClaimed(msg.sender);
        // Send
        msg.sender.transfer(_amountWei);
    }

    /**
     * @notice Method for withdrawing funds that were opt-out by users. Only accessible form governance address
     * @return _amountWei withdrawn opt-out wei
     * @param _targetAddress an address to withdraw funds to
     */
    function withdrawOptOutWei(address _targetAddress) external onlyGovernance entitlementStarted mustBalance 
        returns(uint256 _amountWei) 
    {
        require(totalOptOutWei > 0, ERR_NO_BALANCE_CLAIMABLE);
        require(totalOptOutWei != withdrawnOptOutWei, ERR_NO_BALANCE_CLAIMABLE);
        // Update opt-out balance
        _amountWei = totalOptOutWei.sub(withdrawnOptOutWei);
        withdrawnOptOutWei = totalOptOutWei;
        // emit the event
        emit OptOutWeiWithdrawn();
        // Send Wei to address
        payable(_targetAddress).transfer(_amountWei);
    }

    /**
     * @notice current claimable amount of wei for requesting account
     * @return _amountWei amount of wei available for this account at current time
     */
    function getClaimableAmount() external view override entitlementStarted 
        returns(uint256 _amountWei) 
    {
        _amountWei = _getCurrentClaimableWei(msg.sender);
    }

    /**
     * @notice current claimable amount of wei for account
     * @param account the address of an account we want to get the available wei
     * @return _amountWei amount of wei available for provided account at current time
     */
    function getClaimableAmountOf(address account) external view override entitlementStarted 
        returns(uint256 _amountWei) 
    {
        _amountWei = _getCurrentClaimableWei(account);
    }

    /**
     * @notice Time till next Wei will be claimable (in secods)
     * @return timeTill (sec) Time till next claimable Wei in seconds
     */
    function secondsTillNextClaim() external view override entitlementStarted 
        returns(uint256 timeTill) 
    {
        timeTill = _timeTillNextClaim(msg.sender);
    }

    /**
     * @notice Get the claimable percent for the current timestamp
     * @dev Every 30 days from initial day 3% of the total amount is unlocked and becomes available for claiming
     * @return percentBips maximal claimable bips at given time
     */
    function _getCurrentClaimablePercent() internal view entitlementStarted 
        returns(uint256 percentBips)
    {
        uint256 diffDays = block.timestamp.sub(entitlementStartTs).div(1 days);
        percentBips = Math.min(diffDays.div(30).mul(MONTHLY_CLAIMABLE_BIPS),TOTAL_CLAIMABLE_BIPS);
    }

    /**
     * @notice Get current claimable ammount for users account
     * @dev Every 30 days from initial day 3% of the revard is released
     */
    function _getCurrentClaimableWei(address _owner) internal view entitlementStarted accountCanClaim(_owner) 
        returns(uint256 claimableWei)
    {
        // Attempt to get the account in question
        AirdropAccount memory airdropAccount = airdropAccounts[_owner];
        uint256 currentMaxClaimableBips = _getCurrentClaimablePercent();
        uint256 tempCla=airdropAccount.entitlementBalanceWei.mulDiv(currentMaxClaimableBips,TOTAL_CLAIMABLE_BIPS);
        // Can never claime more that we are initially entiteled to
        tempCla = Math.min(tempCla, airdropAccount.entitlementBalanceWei).toUint128();
        // Substract already claimed
        claimableWei = tempCla - airdropAccount.totalClaimedWei; 
    }

    /**
     * @notice Calculate the time till nex entitelment Wei is released  
     */
    function _timeTillNextClaim(address _account) internal view entitlementStarted accountCanClaim(_account) 
        returns(uint256 timeTill) 
    {
        // Get the account we want to check
        require(block.timestamp.sub(entitlementStartTs).div(MONTH) < 29, ERR_FULLY_CLAIMED);
        timeTill = MONTH.sub(block.timestamp.sub(entitlementStartTs).mod(MONTH));
    }

    /**
     * @notice Compute the expected balance of this contract.
     * @param _balanceExpectedWei   The computed balance expected.
     */
    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return totalEntitlementWei.sub(totalClaimedWei).sub(withdrawnOptOutWei);
    }
}
