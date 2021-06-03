// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIRewardManager.sol";
import { CheckPointHistory } from "../../token/lib/CheckPointHistory.sol";
import { CheckPointHistoryCache } from "../../token/lib/CheckPointHistoryCache.sol";
import "../../governance/implementation/Governed.sol";
import "../../inflation/implementation/Inflation.sol";
import "../../rewardPool/interface/IIRewardPool.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Supply contract
 * @notice This contract maintains and computes various FLR supply totals.
 **/

contract Supply is Governed {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointHistoryCache for CheckPointHistoryCache.CacheState;
    using SafeMath for uint256;

    struct SupplyData {
        uint256 totalSupplyWei;
        uint256 distributedSupplyWei;
    }

    struct InflationSupplyData {
        uint256 totalInflationAuthorizedWei;
        uint256 totalClaimedWei;
        bool added;
    }

    string internal constant ERR_NO_ACCESS = "Access denied";
    string internal constant ERR_REWARD_POOL_ALREADY_ADDED = "Reward pool already added";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_INITIAL_GENESIS_AMOUNT_ZERO = "initial genesis amount zero";

    CheckPointHistory.CheckPointHistoryState private circulatingSupply;
    CheckPointHistoryCache.CacheState private circulatingSupplyCache;

    uint256 immutable public initialGenesisAmountWei;
    uint256 public totalInflationAuthorizedWei;
    SupplyData public foundationSupply;
    mapping(address => SupplyData) public rewardPools;
    mapping(address => InflationSupplyData) public rewardManagers;

    Inflation public inflation;
    address public burnAddress;

    // balance of burn address at last check - needed to update circulating supply
    uint256 private burnAddressBalance;

    modifier onlyInflation {
        require(msg.sender == address(inflation), ERR_NO_ACCESS);
        _;
    }

    modifier onlyRewardPool {
        require(rewardPools[msg.sender].totalSupplyWei > 0, ERR_NO_ACCESS);
        _;
    }

    modifier onlyRewardManager {
        require(rewardManagers[msg.sender].added, ERR_NO_ACCESS);
        _;
    }

    constructor(
        address _governance,
        address _burnAddress,
        Inflation _inflation,
        uint256 _initialGenesisAmountWei,
        uint256 _totalFoundationSupplyWei,
        IIRewardPool[] memory _rewardPools
    ) Governed(_governance) {
        require(address(_inflation) != address(0), ERR_INFLATION_ZERO);
        require(_initialGenesisAmountWei > 0, ERR_INITIAL_GENESIS_AMOUNT_ZERO);
        burnAddress = _burnAddress;
        inflation = _inflation;
        initialGenesisAmountWei = _initialGenesisAmountWei;
        foundationSupply.totalSupplyWei = _totalFoundationSupplyWei;

        _increaseCirculatingSupply(_initialGenesisAmountWei.sub(_totalFoundationSupplyWei));

        for (uint256 i = 0; i < _rewardPools.length; i++) {
            _addRewardPool(_rewardPools[i]);
        }

        _updateBurnAddressAmount();
    }

    /**
     * @notice When new inflaion is authorized, it is sent to rewards managers and updated here as they also 
        report new values through updateRewardManagerData at the same block
     * @param _amountWei                             Authorized inflation amount
     * @dev Also updates the burn address amount once a day
    */
    function addAuthorizedInflation(uint256 _amountWei) external onlyInflation {
        totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(_amountWei);
        _increaseCirculatingSupply(_amountWei);
        _updateBurnAddressAmount();
    }

    /**
     * @notice Adds reward pool so it can call updateRewardPoolDistributedAmount method when 
        some tokens are distributed
     * @param _rewardPool                           Reward pool address
     * @param _decreaseFoundationSupplyByAmountWei  If reward poll was given initial supply from fundation supply, 
        decrease it's value by this amount
     */
    function addRewardPool(
        IIRewardPool _rewardPool,
        uint256 _decreaseFoundationSupplyByAmountWei
    ) external onlyGovernance {
        _decreaseFoundationSupply(_decreaseFoundationSupplyByAmountWei);
        _addRewardPool(_rewardPool);
    }

    /**
     * @notice Adds reward manager so it can call updateRewardManagerData method
     * @param _rewardManager                        Reward manager address
     */
    function addRewardManager(IIRewardManager _rewardManager) external onlyGovernance {
        InflationSupplyData storage data = rewardManagers[address(_rewardManager)];
        data.added = true;
    }

    /**
     * @notice Decrease foundation supply when a new reward pool is created or some foundation member rewards are sent
     * @param _amountWei                            Amount to decrease by
     */
    function decreaseFoundationSupply(uint256 _amountWei) external onlyGovernance {
        _decreaseFoundationSupply(_amountWei);
    }

    /**
     * @notice Change burn address
     * @param _burnAddress                          New burn address
     * @dev Updates burn value for current address, changes to new address and updates again
     */
    function changeBurnAddress(address _burnAddress) external onlyGovernance {
        _updateBurnAddressAmount();
        burnAddressBalance = 0;
        burnAddress = _burnAddress;
        _updateBurnAddressAmount();
    }

    /**
     * @notice Called from reward manager when new authorized inflation is sent to it
     * @param _totalInflationAuthorizedWei          New total authorized inflation
     * @param _totalClaimedWei                      Total value of claimed rewards
    */
    function updateRewardManagerData(
        uint256 _totalInflationAuthorizedWei,
        uint256 _totalClaimedWei
    ) external onlyRewardManager {
        assert(_totalInflationAuthorizedWei >= _totalClaimedWei);
        InflationSupplyData storage data = rewardManagers[msg.sender];
        _decreaseCirculatingSupply(_totalInflationAuthorizedWei.sub(data.totalInflationAuthorizedWei));
        _increaseCirculatingSupply(_totalClaimedWei.sub(data.totalClaimedWei));
        data.totalInflationAuthorizedWei = _totalInflationAuthorizedWei;
        data.totalClaimedWei = _totalClaimedWei;
    }

    /**
     * @notice Called from reward pool when some amount of FLRs is distributed (or once per day)
     * @param _distributedAmountWei                 Total value of distributed amount
    */
    function updateRewardPoolDistributedAmount(uint256 _distributedAmountWei) external onlyRewardPool {
        SupplyData storage data = rewardPools[msg.sender];
        assert(data.totalSupplyWei >= _distributedAmountWei);
        _increaseCirculatingSupply(_distributedAmountWei.sub(data.distributedSupplyWei));
        data.distributedSupplyWei = _distributedAmountWei;
    }
    
    /**
     * @notice Get approximate circulating supply for given block number from cache - only past block
     * @param _blockNumber                          Block number
     * @return Return approximate circulating supply for last known block <= _blockNumber
    */
    function getCirculatingSupplyAtCached(uint256 _blockNumber) external returns(uint256) {
        // use cache only for the past (the value will never change)
        require(_blockNumber < block.number, "Can only be used for past blocks");
        return circulatingSupplyCache.valueAt(circulatingSupply, _blockNumber);
    }

    /**
     * @notice Get approximate circulating supply for given block number
     * @param _blockNumber                          Block number
     * @return Return approximate circulating supply for last known block <= _blockNumber
    */
    function getCirculatingSupplyAt(uint256 _blockNumber) external view returns(uint256) {
        return circulatingSupply.valueAt(_blockNumber);
    }

    /**
     * @notice Get total inflatable balance (initial genesis amount + total authorized inflation)
     * @return Return inflatable balance
    */
    function getInflatableBalance() external view returns(uint256) {
        return initialGenesisAmountWei.add(totalInflationAuthorizedWei);
    }

    function _increaseCirculatingSupply(uint256 _increaseBy) internal {
        circulatingSupply.writeValue(circulatingSupply.valueAtNow().add(_increaseBy));
    }

    function _decreaseCirculatingSupply(uint256 _descreaseBy) internal {
        circulatingSupply.writeValue(circulatingSupply.valueAtNow().sub(_descreaseBy));
    }

    function _updateBurnAddressAmount() internal {
        uint256 newBalance = burnAddress.balance;
        _decreaseCirculatingSupply(newBalance.sub(burnAddressBalance));
        burnAddressBalance = newBalance;
    }

    function _addRewardPool(IIRewardPool _rewardPool) internal {
        SupplyData storage data = rewardPools[address(_rewardPool)];
        require(data.totalSupplyWei == 0, ERR_REWARD_POOL_ALREADY_ADDED);

        data.totalSupplyWei = _rewardPool.totalSupplyWei();
        data.distributedSupplyWei = _rewardPool.distributedSupplyWei();

        _decreaseCirculatingSupply(data.totalSupplyWei.sub(data.distributedSupplyWei));
    }
    
    function _decreaseFoundationSupply(uint256 _amountWei) internal {
        assert(foundationSupply.totalSupplyWei.sub(foundationSupply.distributedSupplyWei) >= _amountWei);
        _increaseCirculatingSupply(_amountWei);
        foundationSupply.distributedSupplyWei = foundationSupply.distributedSupplyWei.add(_amountWei);
    }
}