// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../governance/implementation/Governed.sol";
import "../../inflation/implementation/Supply.sol";
import "../../personalDelegation/implementation/DelegationAccountManager.sol";
import "../../token/implementation/WNat.sol";
import "../../utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../../userInterfaces/IDistributionToDelegators.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../interface/IITokenPool.sol";
import "../../genesis/implementation/DistributionTreasury.sol";
import "./UnearnedRewardBurner.sol";

/**
 * @title Distribution to delegators
 * @notice A contract to manage the ongoing airdrop distribution after the initial airdrop allocation.
 * The remaining amount is distributed by this contract, with a set rate every 30 days
 * @notice The balance that will be added to this contract must initially be a part of circulating supply
 **/
contract DistributionToDelegators is IDistributionToDelegators, IITokenPool,
    Governed, ReentrancyGuard, AddressUpdatable
{
    using SafeMath for uint256;
    using SafePct for uint256;

    // constants
    uint256 internal constant WEEK = 7 days;
    uint256 internal constant MONTH = 30 days;
    uint256 internal constant NUMBER_OF_VOTE_POWER_BLOCKS = 3;
    uint256 internal constant TOTAL_CLAIMABLE_BIPS = 8500;
    // 2.37% every 30 days (so total distribution takes 36 * 30 days =~ 3 years)
    uint256 internal constant MONTHLY_CLAIMABLE_BIPS = 237;
    uint256 internal constant NUMBER_OF_MONTHS = TOTAL_CLAIMABLE_BIPS / MONTHLY_CLAIMABLE_BIPS + 1; // 36

    // Errors
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_BALANCE_TOO_LOW = "balance too low";
    string internal constant ERR_IN_THE_PAST = "in the past";
    string internal constant ERR_NOT_STARTED = "not started";
    string internal constant ERR_ALREADY_FINISHED = "already finished";
    string internal constant ERR_MONTH_EXPIRED = "month expired";
    string internal constant ERR_MONTH_NOT_CLAIMABLE = "month not claimable";
    string internal constant ERR_MONTH_NOT_CLAIMABLE_YET = "month not claimable yet";
    string internal constant ERR_CLAIM_FAILED = "claim failed";
    string internal constant ERR_OPT_OUT = "already opted out";
    string internal constant ERR_NOT_OPT_OUT = "not opted out";
    string internal constant ERR_DELEGATION_ACCOUNT_ZERO = "delegation account zero";
    string internal constant ERR_TREASURY_ONLY = "treasury only";
    string internal constant ERR_ALREADY_STARTED = "already started";
    string internal constant ERR_WRONG_START_TIMESTAMP = "wrong start timestamp";

    // storage
    uint256 public immutable totalEntitlementWei;       // Total wei to be distributed (all but initial airdrop)
    uint256 public immutable latestEntitlementStartTs;  // Latest day 0 when contract starts
    uint256 public totalClaimedWei;         // All wei already claimed
    uint256 public totalBurnedWei;          // Amounts that were not claimed in time and expired and was burned
    uint256 public totalDistributableAmount;// Total distributable amount (sum of totalAvailableAmount)
    uint256 public entitlementStartTs;      // Day 0 when contract starts
    // id of the first month to expire. Closed = expired and unclaimed amount will be redistributed
    uint256 internal nextMonthToExpireCandidate;

    mapping(uint256 => uint256) public startBlockNumber; // mapping from month to first block used in randomization
    mapping(uint256 => uint256) public endBlockNumber; // mapping from month to last block used in randomization
    mapping(uint256 => uint256[]) public votePowerBlockNumbers; // mapping from month to blocks used in claiming 
    mapping(uint256 => uint256) public totalAvailableAmount; // mapping from month to total available amount
    mapping(uint256 => uint256) public totalUnclaimedAmount; // mapping from month to unclaimed amount
    mapping(uint256 => uint256) public totalUnclaimedWeight; // mapping from month to weight of unclaimed amount
    mapping(address => mapping(uint256 => uint256)) internal claimed; // mapping from address to claimed amount / month

    mapping(address => bool) public optOutCandidate; // indicates if user has triggered to opt out of airdrop
    mapping(address => bool) public optOut; // indicates if user is opted out of airdrop (confirmed by governance)
    address[] public optOutAddresses; // all opted out addresses (confirmed by governance)
    bool public stopped;

    // contracts
    IPriceSubmitter public immutable priceSubmitter;
    DistributionTreasury public immutable treasury;
    WNat public wNat;
    Supply public supply;
    DelegationAccountManager public delegationAccountManager;

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        require (_getExpectedBalance() <= address(this).balance, ERR_BALANCE_TOO_LOW);
    }

    /**
     * @dev This modifier ensures that the entitelment was already started
     */
    modifier entitlementStarted {
        require (entitlementStartTs < block.timestamp, ERR_NOT_STARTED);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        IPriceSubmitter _priceSubmitter,
        DistributionTreasury _treasury,
        uint256 _totalEntitlementWei,
        uint256 _latestEntitlementStartTs
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {
        require(address(_priceSubmitter) != address(0), ERR_ADDRESS_ZERO);
        require(address(_treasury) != address(0), ERR_ADDRESS_ZERO);
        require(address(_treasury).balance >= _totalEntitlementWei, ERR_BALANCE_TOO_LOW);
        require(_latestEntitlementStartTs >= block.timestamp, ERR_IN_THE_PAST);
        priceSubmitter = _priceSubmitter;
        treasury = _treasury;
        totalEntitlementWei = _totalEntitlementWei;
        latestEntitlementStartTs = _latestEntitlementStartTs;
        entitlementStartTs = _latestEntitlementStartTs;
        emit EntitlementStart(_latestEntitlementStartTs);
    }

    /**
     * @notice Needed in order to receive funds from DistributionTreasury
     */
    receive() external payable {
        require(msg.sender == address(treasury), ERR_TREASURY_ONLY);
    }

    function stop() external onlyGovernance {
        stopped = true;
    }

    /**
     * @notice Start the distribution contract at _entitlementStartTs timestamp
     * @param _entitlementStartTs point in time when we start
     */
    function setEntitlementStart(uint256 _entitlementStartTs) external onlyGovernance {
        require(entitlementStartTs > block.timestamp, ERR_ALREADY_STARTED);
        require(_entitlementStartTs >= block.timestamp && _entitlementStartTs <= latestEntitlementStartTs,
            ERR_WRONG_START_TIMESTAMP);
        entitlementStartTs = _entitlementStartTs;
        emit EntitlementStart(_entitlementStartTs);
    }

    /**
     * @notice Method to opt-out of receiving airdrop rewards
     */
    function optOutOfAirdrop() external override {
        require(!optOutCandidate[msg.sender], ERR_OPT_OUT);
        optOutCandidate[msg.sender] = true;
        // emit opt out event
        emit AccountOptOut(msg.sender, false);
    }

    /**
     * @notice Confirm opt out addresses
     * @param _optOutAddresses addresses to opt out
     */
    function confirmOptOutOfAirdrop(address[] calldata _optOutAddresses) external onlyGovernance {
        uint256 len = _optOutAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            address optOutAddress = _optOutAddresses[i];
            require(optOutCandidate[optOutAddress], ERR_NOT_OPT_OUT);
            require(!optOut[optOutAddress], ERR_OPT_OUT);
            optOut[optOutAddress] = true;
            optOutAddresses.push(optOutAddress);
            // emit opt out event
            emit AccountOptOut(optOutAddress, true);
        }
    }

    /**
     * @notice Method for claiming unlocked airdrop amounts for specified month
     * @param _recipient address representing the recipient of the reward
     * @param _month month of interest
     * @return _amountWei claimed wei
     */
    function claim(address payable _recipient, uint256 _month) external override 
        entitlementStarted mustBalance nonReentrant
        returns(uint256 _amountWei)
    {
        return _claim(msg.sender, _recipient, _month);
    }

    /**
     * @notice Method for claiming unlocked airdrop amounts for specified month to personal delegation account
     * @param _month month of interest
     * @return _amountWei claimed wei
     */
    function claimToPersonalDelegationAccount(uint256 _month) external override 
        entitlementStarted mustBalance nonReentrant
        returns(uint256 _amountWei)
    {
        address delegationAccount = delegationAccountManager.accountToDelegationAccount(msg.sender);
        require(delegationAccount != address(0), ERR_DELEGATION_ACCOUNT_ZERO);
        return _claim(msg.sender, payable(delegationAccount), _month);
    }

    /**
     * @notice Return token pool supply data
     * @return _lockedFundsWei                  Foundation locked funds (wei)
     * @return _totalInflationAuthorizedWei     Total inflation authorized amount (wei)
     * @return _totalClaimedWei                 Total claimed amount (wei)
     */
    function getTokenPoolSupplyData() external override mustBalance nonReentrant
        returns (uint256 _lockedFundsWei, uint256 _totalInflationAuthorizedWei, uint256 _totalClaimedWei)
    {
        // update only if called from supply
        // update start and end block numbers, calculate random vote power blocks, expire too old month, pull funds
        if (msg.sender == address(supply)) {
            _updateMonthlyClaimData();
        }

        // This is the total amount of tokens that are actually already in circulating supply
        _lockedFundsWei = stopped ? totalDistributableAmount : totalEntitlementWei;
        // We will never increase this balance since distribution funds are taken from genesis
        // amounts and not from inflation.
        _totalInflationAuthorizedWei = 0;
        // What was actually already added to circulating supply
        _totalClaimedWei = totalClaimedWei.add(totalBurnedWei);
    }

    /**
     * @notice get claimable amount of wei for requesting account for specified month
     * @param _month month of interest
     * @return _amountWei amount of wei available for this account and provided month
     */
    function getClaimableAmount(uint256 _month) external view override entitlementStarted
        returns(uint256 _amountWei)
    {
        (, _amountWei) = _getClaimableWei(msg.sender, _month);
    }

    /**
     * @notice get claimable amount of wei for account for specified month
     * @param _account the address of an account we want to get the claimable amount of wei
     * @param _month month of interest
     * @return _amountWei amount of wei available for provided account and month
     */
    function getClaimableAmountOf(address _account, uint256 _month) external view override entitlementStarted
        returns(uint256 _amountWei)
    {
        (, _amountWei) = _getClaimableWei(_account, _month);
    }

    /**
     * @notice get claimable amount of wei for requesting account for specified month
     * @param _month month of interest
     * @return _amountWei amount of wei claimed for this account and provided month
     */
    function getClaimedAmount(uint256 _month) external view override entitlementStarted
        returns(uint256 _amountWei)
    {
        return claimed[msg.sender][_month];
    }

    /**
     * @notice get claimed amount of wei for account for specified month
     * @param _account the address of an account we want to get the claimable amount of wei
     * @param _month month of interest
     * @return _amountWei amount of wei claimed for provided account and month
     */
    function getClaimedAmountOf(address _account, uint256 _month) external view override entitlementStarted
        returns(uint256 _amountWei)
    {
        return claimed[_account][_month];
    }

    /**
     * @notice Time till next Wei will be claimable (in secods)
     * @return _timeTill (sec) Time till next claimable Wei in seconds
     */
    function secondsTillNextClaim() external view override entitlementStarted
        returns(uint256 _timeTill)
    {
        require(block.timestamp.sub(entitlementStartTs).div(MONTH) < NUMBER_OF_MONTHS, ERR_ALREADY_FINISHED);
        return MONTH.sub(block.timestamp.sub(entitlementStartTs).mod(MONTH));
    }

    /**
     * @notice Returns the current month
     * @return _currentMonth Current month, 0 before entitlementStartTs
     */
    function getCurrentMonth() public view override returns (uint256 _currentMonth) {
        (, uint256 diffSec) = block.timestamp.trySub(entitlementStartTs);
        return diffSec.div(MONTH);
    }

    /**
     * @notice Returns the month that will expire next
     * @return _monthToExpireNext Month that will expire next, 36 when last month expired
     */
    function getMonthToExpireNext() public view override returns (uint256 _monthToExpireNext) {
        uint256 cleanupBlockNumber = wNat.cleanupBlockNumber();
        uint256 blockNumber = startBlockNumber[nextMonthToExpireCandidate];
        if (blockNumber > 0 && blockNumber < cleanupBlockNumber) return nextMonthToExpireCandidate + 1;
        return nextMonthToExpireCandidate;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Update contracts

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        wNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
        supply = Supply(_getContractAddress(_contractNameHashes, _contractAddresses, "Supply"));
        delegationAccountManager = DelegationAccountManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "DelegationAccountManager"));
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Helpers

    /**
     * @notice Method for claiming unlocked airdrop amounts for specified month
     * @param _rewardOwner address of the owner of airdrop rewards
     * @param _recipient address representing the recipient of the reward
     * @param _month month of interest
     */
    function _claim(address _rewardOwner, address payable _recipient, uint256 _month) internal returns(uint256) {
        (uint256 weight, uint256 claimableWei) = _getClaimableWei(_rewardOwner, _month);
        // Make sure we are not withdrawing 0 funds
        if (claimableWei > 0) {
            claimed[_rewardOwner][_month] = claimableWei;
            // Update grand total claimed
            totalClaimedWei = totalClaimedWei.add(claimableWei);
            totalUnclaimedAmount[_month] = totalUnclaimedAmount[_month].sub(claimableWei);
            totalUnclaimedWeight[_month] = totalUnclaimedWeight[_month].sub(weight);
            // transfer funds
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send          // amount always calculated by _getClaimableWei
            (bool success, ) = _recipient.call{value: claimableWei}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_CLAIM_FAILED);
            // Emit the claim event
            emit AccountClaimed(_rewardOwner, _recipient, _month, claimableWei);
        }
        return claimableWei;
    }

    /**
     * @notice Update start and end block numbers, calculate random vote power blocks, expire too old month, pull funds
     * @dev Only do some updates if distribution already started and not yet expired
     */
     //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant in getTokenPoolSupplyData()
    function _updateMonthlyClaimData() internal {
        if (entitlementStartTs == 0 || entitlementStartTs > block.timestamp 
            || nextMonthToExpireCandidate >= NUMBER_OF_MONTHS) return;

        uint256 diffSec = block.timestamp.sub(entitlementStartTs);
        uint256 currentMonth = diffSec.div(MONTH);
        
        // can be called multiple times per block - update only needed once
        if (endBlockNumber[currentMonth] == block.number) return;

        uint256 remainingSec = diffSec - currentMonth * MONTH;
        uint256 currentWeek = remainingSec.div(WEEK);

        // if not the first week, which is left out for claiming, update start/end blocks
        if (currentWeek > 0 && currentMonth < NUMBER_OF_MONTHS) {
            // set starting block if not set yet
            if (startBlockNumber[currentMonth] == 0) {
                startBlockNumber[currentMonth] = block.number;
            }
            // update ending block
            endBlockNumber[currentMonth] = block.number;
        }

        // expire old month
        uint256 cleanupBlockNumber = wNat.cleanupBlockNumber();
        uint256 blockNumber = startBlockNumber[nextMonthToExpireCandidate];
        if (blockNumber > 0 && blockNumber < cleanupBlockNumber) {
            uint256 toBurnWei = totalUnclaimedAmount[nextMonthToExpireCandidate];
            nextMonthToExpireCandidate++;

            // Any to burn?
            if (toBurnWei > 0) {
                // Accumulate what we are about to burn
                totalBurnedWei = totalBurnedWei.add(toBurnWei);
                // Get the burn address; make it payable
                address payable burnAddress = payable(supply.burnAddress());
                // Burn baby burn
                UnearnedRewardBurner unearnedRewardBurner = new UnearnedRewardBurner(burnAddress);
                //slither-disable-next-line arbitrary-send
                address(unearnedRewardBurner).transfer(toBurnWei);
                unearnedRewardBurner.die();
            }
        }

        // if in the last week, calculate votePowerBlocks and pull amount
        // it could be called twice - just to be sure it is called at least once
        if (currentWeek == 4 && currentMonth < NUMBER_OF_MONTHS && !stopped) {
            _updateVotePowerBlocksAndWeight(currentMonth);
            _updateDistributableAmount(currentMonth);
        }
    }
    
    /**
     * @notice Calculate and pull the distributable amount for the specified month
     * @param _month month of interest
     * @dev Every 30 days from initial day 1/36 of the total amount is unlocked and becomes available for claiming
     *      This method could be called more than once per month, so take care to only pull once
     */
    function _updateDistributableAmount(uint256 _month) internal {
        if (_month < NUMBER_OF_MONTHS && totalAvailableAmount[_month] == 0) {
            // maximal claimable bips for this month
            uint256 claimBIPS = Math.min((_month + 1).mul(MONTHLY_CLAIMABLE_BIPS), TOTAL_CLAIMABLE_BIPS);
            // what can be distributed minus what was already distributed till now
            uint256 amountWei = totalEntitlementWei.mulDiv(claimBIPS, TOTAL_CLAIMABLE_BIPS) - totalDistributableAmount;
            // update total values
            totalAvailableAmount[_month] = amountWei;
            totalUnclaimedAmount[_month] = amountWei;
            totalDistributableAmount += amountWei;
            // pull funds
            treasury.pullFunds(amountWei);
        }
    }

    /**
     * @notice Calculate random vote power blocks and weight for the specified month
     * @param _month month of interest
     * @dev Can be called more than once per month, last call for specified month should apply
     */
    function _updateVotePowerBlocksAndWeight(uint256 _month) internal {
        uint256 startBlock = startBlockNumber[_month];
        uint256 endBlock = endBlockNumber[_month];
        // no underflow as both are set at the same time, only endBlock can be updated later
        uint256 slotSize = (endBlock - startBlock) / NUMBER_OF_VOTE_POWER_BLOCKS;

        uint256[] memory votePowerBlocks = new uint256[](NUMBER_OF_VOTE_POWER_BLOCKS);
        uint256 random = block.timestamp + priceSubmitter.getCurrentRandom();
        for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
            random = uint256(keccak256(abi.encode(random, i)));
            //slither-disable-next-line weak-prng
            uint256 votePowerBlock = startBlock + i * slotSize + random % slotSize;
            votePowerBlocks[i] = votePowerBlock;
        }
        votePowerBlockNumbers[_month] = votePowerBlocks;
        totalUnclaimedWeight[_month] = _calculateUnclaimedWeight(votePowerBlocks);
    }

    /**
     * @notice Get the total unclaimed weight for the specified vote power blocks
     * @param _votePowerBlocks array of vote power blocks of interest
     * @return _amountWei unclaimed weight of wei at vote power blocks
     */
    function _calculateUnclaimedWeight(uint256[] memory _votePowerBlocks) internal view returns (uint256 _amountWei) {
        for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
            _amountWei += wNat.totalSupplyAt(_votePowerBlocks[i]);
        }
        uint256 len = optOutAddresses.length;
        while (len > 0) {
            len--;
            address optOutAddress = optOutAddresses[len];
            for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
                _amountWei -= wNat.balanceOfAt(optOutAddress, _votePowerBlocks[i]);
            }
        }
    }

    /**
     * @notice Get weight and claimable amount for users account for the specified month
     * @param _owner address of interest
     * @param _month month of interest
     * @dev Every 30 days from initial day 1/36 of the amount is released
     */
    function _getClaimableWei(address _owner, uint256 _month) internal view entitlementStarted
        returns(uint256 _weight, uint256 _claimableWei)
    {
        require(!optOut[_owner], ERR_OPT_OUT);
        require(getMonthToExpireNext() <= _month, ERR_MONTH_EXPIRED);
        require(_month < NUMBER_OF_MONTHS, ERR_MONTH_NOT_CLAIMABLE);
        require(_month < getCurrentMonth(), ERR_MONTH_NOT_CLAIMABLE_YET);

        if (claimed[_owner][_month] > 0) {
            return (0, 0);
        }

        uint256 unclaimedAmount = totalUnclaimedAmount[_month];
        if (unclaimedAmount == 0) {
            return (0, 0);
        }

        uint256[] memory votePowerBlocks = votePowerBlockNumbers[_month];
        for (uint256 i = 0; i < NUMBER_OF_VOTE_POWER_BLOCKS; i++) {
            _weight += wNat.balanceOfAt(_owner, votePowerBlocks[i]);
        }
        if (_weight == 0) {
            return (0, 0);
        }

        uint256 unclaimedWeight = totalUnclaimedWeight[_month];
        if (_weight == unclaimedWeight) {
            return (_weight, unclaimedAmount);
        }
        assert(_weight < unclaimedWeight);
        return (_weight, unclaimedAmount.mulDiv(_weight, unclaimedWeight));
    }

    /**
     * @notice Compute the expected balance of this contract.
     * @param _balanceExpectedWei The computed balance expected.
     */
    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return totalDistributableAmount.sub(totalClaimedWei).sub(totalBurnedWei);
    }
}
