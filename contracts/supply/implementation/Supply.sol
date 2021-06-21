// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIRewardPool.sol";
import { CheckPointHistory } from "../../token/lib/CheckPointHistory.sol";
import { CheckPointHistoryCache } from "../../token/lib/CheckPointHistoryCache.sol";
import "../../governance/implementation/Governed.sol";
import "../../inflation/implementation/Inflation.sol";
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
        IIRewardPool rewardPool;
        uint256 foundationAllocatedFundsWei;
        uint256 totalInflationAuthorizedWei;
        uint256 totalClaimedWei;
    }

    string internal constant ERR_INFLATION_ONLY = "inflation only";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_REWARD_POOL_ALREADY_ADDED = "reward pool already added";
    string internal constant ERR_INITIAL_GENESIS_AMOUNT_ZERO = "initial genesis amount zero";

    CheckPointHistory.CheckPointHistoryState private circulatingSupply;
    CheckPointHistoryCache.CacheState private circulatingSupplyCache;

    uint256 immutable public initialGenesisAmountWei;
    uint256 public totalInflationAuthorizedWei;
    uint256 public totalFoundationSupplyWei;
    uint256 public distributedFoundationSupplyWei;

    SupplyData[] public rewardPools;

    Inflation public inflation;
    address public burnAddress;

    // balance of burn address at last check - needed for updating circulating supply
    uint256 private burnAddressBalance;

    // events
    event AuthorizedInflationUpdateError(uint256 actual, uint256 expected);

    modifier onlyInflation {
        require(msg.sender == address(inflation), ERR_INFLATION_ONLY);
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
        totalFoundationSupplyWei = _totalFoundationSupplyWei;

        _increaseCirculatingSupply(_initialGenesisAmountWei.sub(_totalFoundationSupplyWei));

        for (uint256 i = 0; i < _rewardPools.length; i++) {
            _addRewardPool(_rewardPools[i]);
        }

        _updateCirculatingSupply();
    }

    /**
     * @notice Update circulating supply
     * @dev Also updates the burn address amount
    */
    function updateAuthorizedInflationAndCirculatingSupply(uint256 inflationAuthorizedWei) external onlyInflation {
        // Save old total inflation authorized value to compare with after update.
        uint256 oldTotalInflationAuthorizedWei = totalInflationAuthorizedWei;
        
        _updateCirculatingSupply();
        
        // Check if new authorized inflation was distributed and updated correctly.
        if (totalInflationAuthorizedWei != oldTotalInflationAuthorizedWei.add(inflationAuthorizedWei)) {
            emit AuthorizedInflationUpdateError(totalInflationAuthorizedWei - oldTotalInflationAuthorizedWei,
                inflationAuthorizedWei);
        }
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
        _updateCirculatingSupply();
    }

    /**
     * @notice Decrease foundation supply when foundation funds are released to a reward pool or team members
     * @param _amountWei                            Amount to decrease by
     */
    function decreaseFoundationSupply(uint256 _amountWei) external onlyGovernance {
        _decreaseFoundationSupply(_amountWei);
        _updateCirculatingSupply();
    }

    /**
     * @notice Change burn address
     * @param _burnAddress                          New burn address
     * @dev Updates burn value for current address, changes to new address and updates again
     */
    function changeBurnAddress(address _burnAddress) external onlyGovernance {
        _updateCirculatingSupply();
        burnAddressBalance = 0;
        burnAddress = _burnAddress;
        _updateBurnAddressAmount();
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

    function _updateCirculatingSupply() internal {
        uint256 len = rewardPools.length;
        for (uint256 i = 0; i < len; i++) {
            SupplyData storage data = rewardPools[i];

            uint256 newFoundationAllocatedFundsWei;
            uint256 newTotalInflationAuthorizedWei;
            uint256 newTotalClaimedWei;
            
            (newFoundationAllocatedFundsWei, newTotalInflationAuthorizedWei, newTotalClaimedWei) = 
                data.rewardPool.getRewardPoolSupplyData();
            assert(newFoundationAllocatedFundsWei.add(newTotalInflationAuthorizedWei) >= newTotalClaimedWei);
            
            // updates total inflation authorized with daily authorized inflation
            uint256 dailyInflationAuthorizedWei = newTotalInflationAuthorizedWei.sub(data.totalInflationAuthorizedWei);
            totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(dailyInflationAuthorizedWei);

            // updates circulating supply
            _decreaseCirculatingSupply(newFoundationAllocatedFundsWei.sub(data.foundationAllocatedFundsWei));
            _increaseCirculatingSupply(newTotalClaimedWei.sub(data.totalClaimedWei));

            // update data
            data.foundationAllocatedFundsWei = newFoundationAllocatedFundsWei;
            data.totalInflationAuthorizedWei = newTotalInflationAuthorizedWei;
            data.totalClaimedWei = newTotalClaimedWei;
        }

        _updateBurnAddressAmount();
    }

    function _updateBurnAddressAmount() internal {
        uint256 newBalance = burnAddress.balance;
        _decreaseCirculatingSupply(newBalance.sub(burnAddressBalance));
        burnAddressBalance = newBalance;
    }

    function _addRewardPool(IIRewardPool _rewardPool) internal {
        uint256 len = rewardPools.length;
        for (uint256 i = 0; i < len; i++) {
            if (_rewardPool == rewardPools[i].rewardPool) {
                revert(ERR_REWARD_POOL_ALREADY_ADDED);
            }
        }
        rewardPools.push();
        rewardPools[len].rewardPool = _rewardPool;
    }
    
    function _decreaseFoundationSupply(uint256 _amountWei) internal {
        assert(totalFoundationSupplyWei.sub(distributedFoundationSupplyWei) >= _amountWei);
        _increaseCirculatingSupply(_amountWei);
        distributedFoundationSupplyWei = distributedFoundationSupplyWei.add(_amountWei);
    }
}