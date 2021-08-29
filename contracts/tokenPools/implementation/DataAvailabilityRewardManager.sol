// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIDataAvailabilityRewardManager.sol";
import "../interface/IITokenPool.sol";
import "../../governance/implementation/Governed.sol";
import "../../token/implementation/WNat.sol";
import "../../utils/implementation/SafePct.sol";
import "../../inflation/implementation/Inflation.sol";
import "../../inflation/interface/IIInflationReceiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * DataAvailabilityRewardManager is in charge of:
 * - distributing rewards according to state of StateConnector
 * - allowing claims for rewards
 */    

//solhint-disable-next-line max-states-count
contract DataAvailabilityRewardManager is 
        IIDataAvailabilityRewardManager, IIInflationReceiver, IITokenPool, Governed, ReentrancyGuard {
    using SafePct for uint256;
    using SafeMath for uint256;

    struct RewardEpochData {                            // used for storing reward epoch data
        uint64 totalDataAvailabilityPeriodsMined;       // total number of data availability periods mined
        uint256 totalRewardWei;                         // total reward (wei) for this reward epoch
        uint64 unclaimedDataAvailabilityPeriodsMined;   // unclaimed number of data availability periods mined
        uint256 unclaimedRewardWei;                     // unclaimed reward (wei) for this reward epoch
    }

    struct RewardClaim {            // used for storing reward claim info
        bool claimed;               // indicates if reward has been claimed
        uint256 amount;             // amount claimed
    }

    struct RewardState {            // used for local storage of reward state
        uint64 weight;              // reward weight
        uint256 amount;             // reward amount
        bool claimed;               // indicates if reward has been claimed
    }

    string internal constant ERR_INFLATION_ONLY = "inflation only";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_STATE_CONNECTOR_ZERO = "no state connector";
    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_CLAIM_FAILED = "claim failed";
    string internal constant ERR_REWARD_MANAGER_DEACTIVATED = "reward manager deactivated";
    string internal constant ERR_UNKNOWN_REWARD_EPOCH = "unknown reward epoch";
    
    bool internal active;

    uint256 public immutable rewardExpiryOffset; // period of reward expiry (in reward epochs)
    
    // id of the first epoch to expire. Closed = expired and unclaimed funds sent back
    uint256 private firstEpochToCheckExpiry; 
    
    mapping(uint256 => mapping(address => RewardClaim)) private epochDataAvailabilityProviderReward;
    RewardEpochData[] internal rewardEpochs;

    // Totals
    uint256 public totalAwardedWei;
    uint256 public totalClaimedWei;
    uint256 public totalExpiredWei; // rewards that were not claimed
    uint256 public totalInflationAuthorizedWei;
    uint256 public totalInflationReceivedWei;
    uint256 public totalSelfDestructReceivedWei;
    uint256 public lastInflationAuthorizationReceivedTs;
    uint256 public dailyAuthorizedInflation;

    uint256 private lastBalance;

    /// addresses
    StateConnector public stateConnector;
    Inflation public inflation;

    modifier mustBalance {
        _;
        require(address(this).balance == _getExpectedBalance(), ERR_OUT_OF_BALANCE);
    }

    modifier onlyIfActive() {
        require(active, ERR_REWARD_MANAGER_DEACTIVATED);
        _;
    }

    modifier onlyInflation {
        require(msg.sender == address(inflation), ERR_INFLATION_ONLY);
        _;
    }

    constructor(
        address _governance,
        uint256 _rewardExpiryOffset,
        StateConnector _stateConnector,
        Inflation _inflation
    )
        Governed(_governance)
    {
        require(address(_stateConnector) != address(0), ERR_STATE_CONNECTOR_ZERO);
        require(address(_inflation) != address(0), ERR_INFLATION_ZERO);

        inflation = _inflation;
        stateConnector = _stateConnector;
        rewardExpiryOffset = _rewardExpiryOffset;
    }

    /**
     * @notice This function is intended to be used to claim rewards.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     */
    function claimReward(
        address payable _recipient,
        uint256[] memory _rewardEpochs
    ) 
        external override
        onlyIfActive
        mustBalance
        nonReentrant 
        returns (uint256 _rewardAmount)
    {
        _handleSelfDestructProceeds();

        uint256 currentRewardEpoch = stateConnector.getRewardPeriod();
                
        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState = _getStateOfRewards(msg.sender, _rewardEpochs[i], true);
            uint256 amount = _claimReward(_recipient, _rewardEpochs[i], rewardState);
            _rewardAmount += amount;
        }

        _transferReward(_recipient, _rewardAmount);

        //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant
        lastBalance = address(this).balance;
    }

    /**
     * @notice Activates reward manager (allows claiming rewards)
     */
    function activate() external override onlyGovernance {
        active = true;
    }

    /**
     * @notice Deactivates reward manager (prevents claiming rewards)
     */
    function deactivate() external override onlyGovernance {
        active = false;
    }
   
    /**
     * @notice sets state connector corresponding to the reward manager
     */
    function setStateConnector(StateConnector _stateConnector) external override onlyGovernance {
        require(address(_stateConnector) != address(0), ERR_STATE_CONNECTOR_ZERO);
        stateConnector = _stateConnector;
    }

    /**
     * @notice Sets inflation contract
     */
    function setInflation(Inflation _inflation) external onlyGovernance {
        require(address(_inflation) != address(0), ERR_INFLATION_ZERO);
        inflation = _inflation;
    }

    function setDailyAuthorizedInflation(uint256 _toAuthorizeWei) external override onlyInflation {
        dailyAuthorizedInflation = _toAuthorizeWei;
        totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(_toAuthorizeWei);
        lastInflationAuthorizationReceivedTs = block.timestamp;

        emit DailyAuthorizedInflationSet(_toAuthorizeWei);

        uint256 currentRewardEpoch = stateConnector.getRewardPeriod();
        _initializeRewardEpochs(currentRewardEpoch);
        _closeExpiredRewardEpochs(currentRewardEpoch);
    }

    function receiveInflation() external payable override mustBalance onlyInflation {
        uint256 currentBalance = _handleSelfDestructProceeds();
        totalInflationReceivedWei = totalInflationReceivedWei.add(msg.value);
        lastBalance = currentBalance;

        emit InflationReceived(msg.value);
    }

    /**
     * @notice Returns information on epoch reward
     * @param _rewardEpoch          reward epoch number
     * @return _totalReward         number representing the total epoch reward
     * @return _claimedReward       number representing the amount of total epoch reward that has been claimed
     */
    function getEpochReward(
        uint256 _rewardEpoch
    )
        external view override
        returns (
            uint256 _totalReward,
            uint256 _claimedReward
        )
    {
        require(_rewardEpoch < rewardEpochs.length, ERR_UNKNOWN_REWARD_EPOCH);
        _totalReward = rewardEpochs[_rewardEpoch].totalRewardWei;
        _claimedReward = _totalReward - rewardEpochs[_rewardEpoch].unclaimedRewardWei; // can not underflow
    }

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @return _amount              reward amount
     * @return _claimed             boolean value indicating if reward is claimed
     * @return _claimable           boolean value indicating if reward is claimable
     * @dev May revert if reward epoch was not initialized yet
     */
    function getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch
    )
        external view override
        returns (
            uint256 _amount,
            bool _claimed,
            bool _claimable
        )
    {
        require(_rewardEpoch < rewardEpochs.length, ERR_UNKNOWN_REWARD_EPOCH);
        RewardState memory rewardState = _getStateOfRewards(_beneficiary, _rewardEpoch, false);
        _amount = rewardState.amount;
        _claimed = rewardState.claimed;
        _claimable = _isRewardClaimable(_rewardEpoch, stateConnector.getRewardPeriod());
    }

    /**
     * @notice Return reward epoch that will expire, when new reward epoch is initialized
     * @return Reward epoch id that will expire next
     */
    function getRewardEpochToExpireNext() external view override returns (uint256) {
        uint256 current = stateConnector.getRewardPeriod();
        if (current > rewardExpiryOffset) {
            return current - rewardExpiryOffset;
        }
        return 0;
    }
    
    /**
     * @notice Return token pool supply data
     * @return _foundationAllocatedFundsWei     Foundation allocated funds (wei)
     * @return _totalInflationAuthorizedWei     Total inflation authorized amount (wei)
     * @return _totalClaimedWei                 Total claimed amount (wei)
     */
    function getTokenPoolSupplyData() external view override 
        returns (
            uint256 _foundationAllocatedFundsWei,
            uint256 _totalInflationAuthorizedWei,
            uint256 _totalClaimedWei
        )
    {
        return (0, totalInflationAuthorizedWei, totalClaimedWei);
    }

    function _handleSelfDestructProceeds() internal returns (uint256 _currentBalance) {
        uint256 expectedBalance = lastBalance.add(msg.value);
        _currentBalance = address(this).balance;
        if (_currentBalance > expectedBalance) {
            // Then assume extra were self-destruct proceeds
            totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(_currentBalance).sub(expectedBalance);
        } else if (_currentBalance < expectedBalance) {
            // This is a coding error
            assert(false);
        }
    }
        
    /**
     * @notice Collects funds from expired reward epochs and totals.
     * @dev Triggered by inflation at set daily authorized inflation call.
     */
    function _closeExpiredRewardEpochs(uint256 currentRewardEpoch) internal {
        uint256 expiredRewards = 0;
        while (firstEpochToCheckExpiry < rewardEpochs.length && 
                !_isRewardClaimable(firstEpochToCheckExpiry, currentRewardEpoch)) {
            expiredRewards += rewardEpochs[firstEpochToCheckExpiry].unclaimedRewardWei;
            emit RewardClaimsExpired(firstEpochToCheckExpiry);
            firstEpochToCheckExpiry++;
        }
        totalExpiredWei = totalExpiredWei.add(expiredRewards);
    }

    /**
     * @notice Distribute authorized inflation to reward epochs not initialized yet.
     * @dev Triggered by inflation at set daily authorized inflation call.
     */
    function _initializeRewardEpochs(uint256 currentRewardEpoch) internal {
        for (uint256 rewardEpoch = rewardEpochs.length; rewardEpoch < currentRewardEpoch; rewardEpoch++) {
            uint64 totalDataAvailabilityPeriodsMined = 
                stateConnector.getTotalDataAvailabilityPeriodsMined(rewardEpoch);
            if (totalDataAvailabilityPeriodsMined == 0) {
                rewardEpochs.push();
            } else {
                uint256 totalEpochReward = _getDistributableInflationBalance().div(currentRewardEpoch - rewardEpoch);
                totalAwardedWei = totalAwardedWei.add(totalEpochReward);
                rewardEpochs.push(
                    RewardEpochData(
                        {
                            totalDataAvailabilityPeriodsMined: totalDataAvailabilityPeriodsMined,
                            totalRewardWei: totalEpochReward,
                            unclaimedDataAvailabilityPeriodsMined: totalDataAvailabilityPeriodsMined,
                            unclaimedRewardWei: totalEpochReward
                        }
                    )
                );
            }
        }
    }

    /**
     * @notice Claims `_rewardAmounts`.
     * @dev Internal function that takes care of reward bookkeeping
     * @param _recipient            address representing the recipient of the reward
     * @param _rewardEpoch          reward epoch number
     * @param _rewardState          object holding reward state
     * @return Returns the total reward amount.
     */
    function _claimReward(
        address payable _recipient,
        uint256 _rewardEpoch,
        RewardState memory _rewardState
    )
        internal
        returns (uint256)
    {
        if (_rewardState.claimed) {
            return 0;
        }

        uint64 rewardWeight = _rewardState.weight;
        if (rewardWeight > 0) {
            rewardEpochs[_rewardEpoch].unclaimedDataAvailabilityPeriodsMined -= rewardWeight; // can not underflow
        }

        uint256 rewardAmount = _rewardState.amount;
        if (rewardAmount > 0) {
            rewardEpochs[_rewardEpoch].unclaimedRewardWei -= rewardAmount; // can not underflow
            totalClaimedWei += rewardAmount;
        }

        RewardClaim storage rewardClaim = epochDataAvailabilityProviderReward[_rewardEpoch][msg.sender];
        rewardClaim.claimed = true;
        rewardClaim.amount = rewardAmount;

        emit RewardClaimed({
            whoClaimed: msg.sender,
            sentTo: _recipient,
            rewardEpoch: _rewardEpoch,
            amount: rewardAmount
        });

        return rewardAmount;
    }

    /**
     * @notice Transfers `_rewardAmount` to `_recipient`.
     * @param _recipient            address representing the reward recipient
     * @param _rewardAmount         number representing the amount to transfer
     * @dev Uses low level call to transfer funds.
     */
    function _transferReward(address payable _recipient, uint256 _rewardAmount) internal {
        if (_rewardAmount > 0) {
            // transfer total amount (state is updated and events are emitted in _claimReward)
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send          // amount always calculated by _claimReward
            (bool success, ) = _recipient.call{value: _rewardAmount}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_CLAIM_FAILED);
        }
    }

    function _getDistributableInflationBalance() internal view returns (uint256) {
        return totalInflationAuthorizedWei
            .sub(totalAwardedWei.sub(totalExpiredWei));
    }
    
    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch`.
     * @dev Internal function
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @param _zeroForClaimed       boolean value that enables skipping amount computation for claimed rewards
     * @return _rewardState         object holding reward state
     */
    function _getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch,
        bool _zeroForClaimed
    )
        internal view 
        returns (RewardState memory _rewardState)
    {
        _rewardState.claimed = _isRewardClaimed(_rewardEpoch, _beneficiary);
        
        if (_rewardState.claimed) {
            if (!_zeroForClaimed) {
                // weight is irrelevant
                _rewardState.amount = _getClaimedReward(_rewardEpoch, _beneficiary);
            }
        } else {
            _rewardState.weight = _getRewardWeight(_beneficiary, _rewardEpoch);
            _rewardState.amount = _getRewardAmount(_rewardEpoch, _rewardState.weight);
        }
    }

    /**
     * @notice Reports if rewards for `_rewardEpoch` are claimable.
     * @param _rewardEpoch          reward epoch number
     * @param _currentRewardEpoch   number of the current reward epoch
     */
    function _isRewardClaimable(uint256 _rewardEpoch, uint256 _currentRewardEpoch) internal view returns (bool) {
        if (_rewardEpoch + rewardExpiryOffset < _currentRewardEpoch) {
                // reward expired
                return false;
        }
        if (_rewardEpoch >= rewardEpochs.length) {
            // reward not ready for distribution
            return false;
        }
        return true;
    }

    /**
     * @notice Reports if reward at `_rewardEpoch` has already been claimed by `_claimer`.
     * @param _rewardEpoch          reward epoch number
     * @param _claimer              address representing a reward claimer
     */
    function _isRewardClaimed(
        uint256 _rewardEpoch,
        address _claimer
    )
        internal view
        returns (bool)
    {
        return epochDataAvailabilityProviderReward[_rewardEpoch][_claimer].claimed;
    }

    /**
     * @notice Returns the reward amount at `_rewardEpoch` claimed by `_claimer`.
     * @param _rewardEpoch          reward epoch number
     * @param _claimer              address representing a reward claimer
     */
    function _getClaimedReward(
        uint256 _rewardEpoch,
        address _claimer
    )
        internal view
        returns (uint256)
    {
        return epochDataAvailabilityProviderReward[_rewardEpoch][_claimer].amount;
    }

    /**
     * @notice Returns the reward amount at `_rewardEpoch`
     * @param _rewardEpoch          reward epoch number
     * @param _rewardWeight         number representing reward weight
     */
    function _getRewardAmount(
        uint256 _rewardEpoch,
        uint64 _rewardWeight
    )
        internal view
        returns (uint256)
    {
        if (_rewardWeight == 0) {
            return 0;
        }
        uint256 unclaimedRewardAmount = rewardEpochs[_rewardEpoch].unclaimedRewardWei;
        if (unclaimedRewardAmount == 0) {
            return 0;
        }
        uint64 unclaimedRewardWeight = rewardEpochs[_rewardEpoch].unclaimedDataAvailabilityPeriodsMined;
        if (_rewardWeight == unclaimedRewardWeight) {
            return unclaimedRewardAmount;
        }
        assert(_rewardWeight < unclaimedRewardWeight);
        return unclaimedRewardAmount.mulDiv(_rewardWeight, unclaimedRewardWeight);
    }

    /**
     * @notice Returns reward weight for `_claimer` at `_rewardEpoch`
     * @param _claimer              address representing a claimer
     * @param _rewardEpoch          reward epoch number
     */
    function _getRewardWeight(
        address _claimer,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint64)
    {
        return stateConnector.getDataAvailabilityPeriodsMined(_claimer, _rewardEpoch);
    }

    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return totalInflationReceivedWei
            .add(totalSelfDestructReceivedWei)
            .sub(totalClaimedWei);
    }
}
