// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIFtsoRewardManager.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "../../governance/implementation/Governed.sol";
import "../../token/implementation/WNat.sol";
import "../../utils/implementation/SafePct.sol";
import "../../inflation/implementation/Supply.sol";
import "./UnearnedRewardBurner.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * FTSORewardManager is in charge of:
 * - distributing rewards according to instructions from FTSO Manager
 * - allowing claims for rewards
 */    

//solhint-disable-next-line max-states-count
contract FtsoRewardManager is IIFtsoRewardManager, Governed, ReentrancyGuard, AddressUpdatable {
    using SafePct for uint256;
    using SafeMath for uint256;

    struct FeePercentage {          // used for storing data provider fee percentage settings
        uint16 value;               // fee percentage value (value between 0 and 1e4)
        uint240 validFromEpoch;     // id of the reward epoch from which the value is valid
    }

    struct RewardClaim {            // used for storing reward claim info
        bool claimed;               // indicates if reward has been claimed
        uint256 amount;             // amount claimed
    }

    struct RewardState {            // used for local storage of reward state
        address[] dataProviders;    // positional array of addresses representing data providers
        uint256[] weights;          // positional array of numbers representing reward weights
        uint256[] amounts;          // positional array of numbers representing reward amounts
        bool[] claimed;             // positional array of booleans indicating if reward has already been claimed
    }

    string internal constant ERR_FTSO_MANAGER_ONLY = "ftso manager only";
    string internal constant ERR_INFLATION_ONLY = "inflation only";
    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_CLAIM_FAILED = "claim failed";
    string internal constant ERR_REWARD_MANAGER_DEACTIVATED = "reward manager deactivated";
    string internal constant ERR_FEE_PERCENTAGE_INVALID = "invalid fee percentage value";
    string internal constant ERR_FEE_PERCENTAGE_UPDATE_FAILED = "fee percentage can not be updated";
    string internal constant ERR_AFTER_DAILY_CYCLE = "after daily cycle";
    string internal constant ERR_NO_CLAIMABLE_EPOCH = "no epoch with claimable rewards";
    string internal constant ERR_EXECUTOR_ONLY = "claim executor only";
    
    uint256 constant internal MAX_BIPS = 1e4;
    uint256 constant internal ALMOST_SEVEN_FULL_DAYS_SEC = 7 days - 1;
    uint256 constant internal MAX_BURNABLE_PCT = 20;

    bool public override active;

    uint256 public immutable feePercentageUpdateOffset; // fee percentage update timelock measured in reward epochs
    uint256 public immutable defaultFeePercentage; // default value for fee percentage
        
    // id of the first epoch to expire. Closed = expired and unclaimed funds sent back
    uint256 private nextRewardEpochToExpire; 
    // reward epoch when setInitialRewardData is called (set to +1) - used for forwarding closeExpiredRewardEpoch
    uint256 private initialRewardEpoch;

    /**
     * @dev Provides a mapping of reward epoch ids to an address mapping of unclaimed rewards.
     */
    mapping(uint256 => mapping(address => uint256)) private epochProviderUnclaimedRewardWeight;
    mapping(uint256 => mapping(address => uint256)) private epochProviderUnclaimedRewardAmount;    
    mapping(uint256 => mapping(address => mapping(address => RewardClaim))) private epochProviderClaimerReward;
    mapping(uint256 => uint256) private totalRewardEpochRewards;
    mapping(uint256 => uint256) private claimedRewardEpochRewards;

    mapping(address => FeePercentage[]) private dataProviderFeePercentages;
    
    // mapping(reward owner address, claim executor address) => bool
    mapping(address => mapping(address => bool)) private allowedClaimExecutors;

    // Totals
    uint256 public totalAwardedWei;     // rewards that were distributed
    uint256 public totalClaimedWei;     // rewards that were claimed in time
    uint256 public totalExpiredWei;     // rewards that were not claimed in time and expired
    uint256 public totalUnearnedWei;    // rewards that were unearned (ftso fallback) and thus not distributed
    uint256 public totalBurnedWei;      // rewards that were unearned or expired and thus burned
    uint256 public totalInflationAuthorizedWei;
    uint256 public totalInflationReceivedWei;
    uint256 public totalSelfDestructReceivedWei;
    uint256 public lastInflationAuthorizationReceivedTs;
    uint256 public dailyAuthorizedInflation;

    uint256 private lastBalance;

    /// addresses
    IIFtsoManager public ftsoManager;
    address private inflation;
    WNat public wNat;
    Supply public supply;

    // for redeploy
    address public immutable oldFtsoRewardManager;
    address public newFtsoRewardManager;

    modifier mustBalance {
        _;
        require(address(this).balance == _getExpectedBalance(), ERR_OUT_OF_BALANCE);
    }

    modifier onlyFtsoManager () {
        require (msg.sender == address(ftsoManager), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    modifier onlyIfActive() {
        require(active, ERR_REWARD_MANAGER_DEACTIVATED);
        _;
    }

    modifier onlyInflation {
        require(msg.sender == inflation, ERR_INFLATION_ONLY);
        _;
    }

    modifier onlyRewardExecutor(address _rewardOwner) {
        require(allowedClaimExecutors[_rewardOwner][msg.sender], ERR_EXECUTOR_ONLY);
        _;
    }
    
    constructor(
        address _governance,
        address _addressUpdater,
        address _oldFtsoRewardManager,
        uint256 _feePercentageUpdateOffset,
        uint256 _defaultFeePercentage
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {
        oldFtsoRewardManager = _oldFtsoRewardManager;
        feePercentageUpdateOffset = _feePercentageUpdateOffset;
        defaultFeePercentage = _defaultFeePercentage;
    }

    /**
     * @notice Allows a percentage delegator to claim rewards.
     * @notice This function is intended to be used to claim rewards in case of delegation by percentage.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
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
        _rewardAmount = _claimOrWrapReward(msg.sender, _recipient, _rewardEpochs, false);
    }

    /**
     * @notice Allows a percentage delegator to claim and wrap rewards.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by percentage.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
     */
    function claimAndWrapReward(
        address payable _recipient,
        uint256[] memory _rewardEpochs
    ) 
        external override
        onlyIfActive
        mustBalance
        nonReentrant 
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapReward(msg.sender, _recipient, _rewardEpochs, true);
    }

    /**
     * @notice Allows a percentage delegator to claim and wrap rewards.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by percentage.
     * @notice The caller does not have to be the owner, but must be approved by the owner to claim on his behalf.
     *   this approval is done by calling `addClaimExecutor`.
     * @notice It is actually safe for this to be called by anybody (nothing can be stolen), but by limiting who can
     *   call, we allow the owner to control the timing of the calls.
     * @param _rewardOwner          address of the reward owner; also, funds will be tranfered there
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
     */
    function claimAndWrapRewardToOwner(
        address payable _rewardOwner,
        uint256[] memory _rewardEpochs
    ) 
        external override
        onlyIfActive
        mustBalance
        nonReentrant
        onlyRewardExecutor(_rewardOwner) 
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapReward(_rewardOwner, _rewardOwner, _rewardEpochs, true);
    }

    /**
     * @notice Allows the sender to claim rewards from specified data providers.
     * @notice This function is intended to be used to claim rewards in case of delegation by amount.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Function can be used by a percentage delegator but is more gas consuming than `claimReward`.
     */
    function claimRewardFromDataProviders(
        address payable _recipient,
        uint256[] memory _rewardEpochs,
        address[] memory _dataProviders
    )
        external override
        onlyIfActive
        mustBalance
        nonReentrant 
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapRewardFromDataProviders(msg.sender, _recipient, 
            _rewardEpochs, _dataProviders, false);
    }

    /**
     * @notice Allows the sender to claim and wrap rewards from specified data providers.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by amount.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Function can be used by a percentage delegator but is more gas consuming than `claimReward`.
     */
    function claimAndWrapRewardFromDataProviders(
        address payable _recipient,
        uint256[] memory _rewardEpochs,
        address[] memory _dataProviders
    )
        external override
        onlyIfActive
        mustBalance
        nonReentrant 
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapRewardFromDataProviders(msg.sender, _recipient, 
            _rewardEpochs, _dataProviders, true);
    }

    /**
     * @notice Allows the sender to claim and wrap rewards from specified data providers.
     * @notice This function is intended to be used to claim and wrap rewards in case of delegation by amount.
     * @notice The caller does not have to be the owner, but must be approved by the owner to claim on his behalf.
     *   this approval is done by calling `addClaimExecutor`.
     * @notice It is actually safe for this to be called by anybody (nothing can be stolen), but by limiting who can
     *   call, we allow the owner to control the timing of the calls.
     * @param _rewardOwner          address of the reward owner; also, funds will be tranfered there
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Function can be used by a percentage delegator but is more gas consuming than `claimReward`.
     */
    function claimAndWrapRewardFromDataProvidersToOwner(
        address payable _rewardOwner,
        uint256[] memory _rewardEpochs,
        address[] memory _dataProviders
    ) 
        external override
        onlyIfActive
        mustBalance
        nonReentrant
        onlyRewardExecutor(_rewardOwner) 
        returns (uint256 _rewardAmount)
    {
        _rewardAmount = _claimOrWrapRewardFromDataProviders(_rewardOwner, _rewardOwner,
            _rewardEpochs, _dataProviders, true);
    }
    
    /**
     * Called by reward owner to allow `_executor` to claim on behalf of the owner.
     * the `_executor` can call `claimAndWrapRewardToOwner` or `claimAndWrapRewardFromDataProvidersToOwner`.
     * @param _executor the account that will be able to claim on behalf of the owner.
     */
    function addClaimExecutor(address _executor)
        external override
    {
        allowedClaimExecutors[msg.sender][_executor] = true;
    }

    /**
     * Called by reward owner to revoke the allowance of an `_executor` to claim on behalf of the owner.
     * @param _executor the account from which the privilege is revoked.
     */
    function removeClaimExecutor(address _executor) 
        external override
    {
        allowedClaimExecutors[msg.sender][_executor] = false;
    }

    /**
     * @notice Activates reward manager (allows claiming rewards)
     */
    function activate() external override onlyGovernance {
        require(inflation != address(0) && address(ftsoManager) != address(0) && 
            address(wNat) != address(0) && address(supply) != address(0),
            "contract addresses not set");
        active = true;
    }

    /**
     * @notice Deactivates reward manager (prevents claiming rewards)
     */
    function deactivate() external override onlyGovernance {
        active = false;
    }

    function setDailyAuthorizedInflation(uint256 _toAuthorizeWei) external override onlyInflation {
        dailyAuthorizedInflation = _toAuthorizeWei;
        totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(_toAuthorizeWei);
        lastInflationAuthorizationReceivedTs = block.timestamp;

        emit DailyAuthorizedInflationSet(_toAuthorizeWei);
    }

    function receiveInflation() external payable override mustBalance onlyInflation {
        (uint256 currentBalance, ) = _handleSelfDestructProceeds();
        totalInflationReceivedWei = totalInflationReceivedWei.add(msg.value);
        lastBalance = currentBalance;
        // If there are accrued rewards pending to burn, do so...
        _burnUnearnedRewards();

        emit InflationReceived(msg.value);
    }

    /**
     * @notice Accrue unearned rewards for price epoch.
     * @dev Typically done when ftso in fallback or because of insufficient vote power.
     *      Simply accrue them so they will not distribute and burn them later.
     */
    function accrueUnearnedRewards(
        uint256 _epochId,
        uint256 _priceEpochDurationSeconds,
        uint256 _priceEpochEndTime // end time included in epoch
    )
        external override
        onlyFtsoManager
    {
        uint256 totalPriceEpochReward = 
            _getTotalPriceEpochRewardWei(_priceEpochDurationSeconds, _priceEpochEndTime);

        totalUnearnedWei = totalUnearnedWei.add(totalPriceEpochReward);

        emit UnearnedRewardsAccrued(_epochId, totalPriceEpochReward);
    }

    /**
     * @notice Distributes rewards to data providers accounts, according to input parameters.
     * @dev must be called with totalWeight > 0 and addresses.length > 0
     */
    function distributeRewards(
        address[] memory _addresses,
        uint256[] memory _weights,
        uint256 _totalWeight,
        uint256 _epochId,
        address _ftso,
        uint256 _priceEpochDurationSeconds,
        uint256 _currentRewardEpoch,
        uint256 _priceEpochEndTime, // end time included in epoch
        uint256 _votePowerBlock
    )
        external override
        onlyFtsoManager
    {
        // FTSO manager should never call with bad values.
        assert (_totalWeight != 0 && _addresses.length != 0);

        uint256 totalPriceEpochReward = 
            _getTotalPriceEpochRewardWei(_priceEpochDurationSeconds, _priceEpochEndTime);

        uint256[] memory rewards = new uint256[](_addresses.length);
        rewards[0] = totalPriceEpochReward;
        _weights[0] = _totalWeight;

        uint256 i = _addresses.length - 1;
        while (true) {
            rewards[i] = rewards[0].mulDiv(_weights[i], _weights[0]);
            epochProviderUnclaimedRewardAmount[_currentRewardEpoch][_addresses[i]] += rewards[i];
            epochProviderUnclaimedRewardWeight[_currentRewardEpoch][_addresses[i]] =
                wNat.votePowerOfAt(_addresses[i], _votePowerBlock).mul(MAX_BIPS);            
            if (i == 0) {
                break;
            }
            rewards[0] -= rewards[i];
            _weights[0] -= _weights[i];
            i--;
        }

        totalRewardEpochRewards[_currentRewardEpoch] += totalPriceEpochReward;

        // Update total awarded with amount distributed
        totalAwardedWei = totalAwardedWei.add(totalPriceEpochReward);

        emit RewardsDistributed(_ftso, _epochId, _addresses, rewards);
    }

    /**
     * @notice Allows data provider to set (or update last) fee percentage.
     * @param _feePercentageBIPS    number representing fee percentage in BIPS
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function setDataProviderFeePercentage(uint256 _feePercentageBIPS) external override returns (uint256) {
        require(_feePercentageBIPS <= MAX_BIPS, ERR_FEE_PERCENTAGE_INVALID);

        uint256 rewardEpoch = getCurrentRewardEpoch() + feePercentageUpdateOffset;
        FeePercentage[] storage fps = dataProviderFeePercentages[msg.sender];

        // determine whether to update the last setting or add a new one
        uint256 position = fps.length;
        if (position > 0) {
            // do not allow updating the settings in the past
            // (this can only happen if the sharing percentage epoch offset is updated)
            require(rewardEpoch >= fps[position - 1].validFromEpoch, ERR_FEE_PERCENTAGE_UPDATE_FAILED);
            
            if (rewardEpoch == fps[position - 1].validFromEpoch) {
                // update
                position = position - 1;
            }
        }
        if (position == fps.length) {
            // add
            fps.push();
        }

        // apply setting
        fps[position].value = uint16(_feePercentageBIPS);
        assert(rewardEpoch < 2**240);
        fps[position].validFromEpoch = uint240(rewardEpoch);

        emit FeePercentageChanged(msg.sender, _feePercentageBIPS, rewardEpoch);
        return rewardEpoch;
    }

    /**
     * @notice Set initial reward data values - only if oldRewardManager is set
     * @dev Should be called at the time of switching to the new reward manager, can be called only once
     */
    function setInitialRewardData() external onlyGovernance {
        require(!active && oldFtsoRewardManager != address(0) && 
            initialRewardEpoch == 0 && nextRewardEpochToExpire == 0, "not initial state");
        initialRewardEpoch = getCurrentRewardEpoch().add(1); // in order to distinguish from 0 
        nextRewardEpochToExpire = ftsoManager.getRewardEpochToExpireNext();
    }

    /**
     * @notice Sets new ftso reward manager which will take over closing expired reward epochs
     * @dev Should be called at the time of switching to the new reward manager, can be called only once
     */
    function setNewFtsoRewardManager(address _newFtsoRewardManager) external onlyGovernance {
        require(newFtsoRewardManager == address(0), "new ftso reward manager already set");
        newFtsoRewardManager = _newFtsoRewardManager;
    }
    
    /**
     * @notice Collects funds from expired reward epoch and totals.
     * @dev Triggered by ftsoManager on finalization of a reward epoch.
     * Operation is irreversible: when some reward epoch is closed according to current
     * settings of parameters, it cannot be reopened even if new parameters would 
     * allow it since nextRewardEpochToExpire in ftsoManager never decreases.
     */
    function closeExpiredRewardEpoch(uint256 _rewardEpoch) external override {
        require (msg.sender == address(ftsoManager) || msg.sender == newFtsoRewardManager,
            "only ftso manager or new ftso reward manager");
        require(nextRewardEpochToExpire == _rewardEpoch, "wrong reward epoch id");
        if (oldFtsoRewardManager != address(0) && _rewardEpoch < initialRewardEpoch) {
            IIFtsoRewardManager(oldFtsoRewardManager).closeExpiredRewardEpoch(_rewardEpoch);
        }

        uint256 expiredWei = totalRewardEpochRewards[_rewardEpoch] - claimedRewardEpochRewards[_rewardEpoch];
        totalExpiredWei = totalExpiredWei.add(expiredWei);
        emit RewardClaimsExpired(_rewardEpoch);
        nextRewardEpochToExpire = _rewardEpoch + 1;
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
        returns (uint256 _totalReward, uint256 _claimedReward) 
    {
        _totalReward = totalRewardEpochRewards[_rewardEpoch];
        _claimedReward = claimedRewardEpochRewards[_rewardEpoch];
    }

    /**
     * @notice Returns the Inflation contract address.
     * @dev Inflation receivers must have a reference to Inflation in order to receive native tokens for claiming.
     * @return The inflation address
     */
    function getInflationAddress() external view override returns(address) {
        return inflation;
    }

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @return _dataProviders       positional array of addresses representing data providers
     * @return _rewardAmounts       positional array of reward amounts
     * @return _claimed             positional array of boolean values indicating if reward is claimed
     * @return _claimable           boolean value indicating if rewards are claimable
     * @dev Reverts when queried with `_beneficary` delegating by amount
     */
    function getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch
    )
        external view override 
        returns (
            address[] memory _dataProviders,
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        ) 
    {
        uint256 currentRewardEpoch = getCurrentRewardEpoch();
        _claimable = _isRewardClaimable(_rewardEpoch, currentRewardEpoch);
        if (_claimable || _rewardEpoch == currentRewardEpoch) {
            RewardState memory rewardState = _getStateOfRewards(_beneficiary, _rewardEpoch, false);
            _dataProviders = rewardState.dataProviders;
            _rewardAmounts = rewardState.amounts;
            _claimed = rewardState.claimed;
        }
    }

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch` from `_dataProviders`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @param _dataProviders        positional array of addresses representing data providers
     * @return _rewardAmounts       positional array of reward amounts
     * @return _claimed             positional array of boolean values indicating if reward is claimed
     * @return _claimable           boolean value indicating if rewards are claimable
     */
    function getStateOfRewardsFromDataProviders(
        address _beneficiary,
        uint256 _rewardEpoch,
        address[] memory _dataProviders
    )
        external view override 
        returns (
            uint256[] memory _rewardAmounts,
            bool[] memory _claimed,
            bool _claimable
        )
    {
        uint256 currentRewardEpoch = getCurrentRewardEpoch();
        _claimable = _isRewardClaimable(_rewardEpoch, currentRewardEpoch);
        if (_claimable || _rewardEpoch == currentRewardEpoch) {
            RewardState memory rewardState = _getStateOfRewardsFromDataProviders(
                _beneficiary,
                _rewardEpoch,
                _dataProviders,
                false
            );
            _rewardAmounts = rewardState.amounts;
            _claimed = rewardState.claimed;
        }
    }

    /**
     * @notice Returns the start and the end of the reward epoch range for which the reward is claimable
     * @return _startEpochId        the oldest epoch id that allows reward claiming
     * @return _endEpochId          the newest epoch id that allows reward claiming
     */
    function getEpochsWithClaimableRewards() external view override 
        returns (uint256 _startEpochId, uint256 _endEpochId)
    {
        (_startEpochId, _endEpochId) = _getEpochsWithClaimableRewards();
    }

    /**
     * @notice Returns the array of claimable epoch ids for which the reward has not yet been claimed
     * @param _beneficiary          address of reward beneficiary
     * @return _epochIds            array of epoch ids
     * @dev Reverts when queried with `_beneficary` delegating by amount
     */
    function getEpochsWithUnclaimedRewards(address _beneficiary) external view override 
        returns (uint256[] memory _epochIds) 
    {
        (uint256 startId, uint256 endId) = _getEpochsWithClaimableRewards();
        uint256 count = endId - startId + 1;        
        bool[] memory unclaimed = new bool[](count);
        uint256 unclaimedCount = 0;
        for (uint256 i = 0; i < count; i++) {
            RewardState memory rewardState = _getStateOfRewards(_beneficiary, startId + i, true);
            for (uint256 j = 0; j < rewardState.claimed.length; j++) {
                if (!rewardState.claimed[j] && rewardState.amounts[j] > 0) {
                    unclaimed[i] = true;
                    unclaimedCount++;
                    break;
                }
            }
        }
        _epochIds = new uint256[](unclaimedCount);
        uint256 index = 0;
        for (uint256 i = 0; i < count; i++) {
            if (unclaimed[i]) {
                _epochIds[index] = startId + i;
                index++;
            }
        }
    }

    /**
     * @notice Returns the information on unclaimed reward of `_dataProvider` for `_rewardEpoch`
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing the data provider
     * @return _amount              number representing the unclaimed amount
     * @return _weight              number representing the share that has not yet been claimed
     */
    function getUnclaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider
    )
        external view override 
        returns (uint256 _amount, uint256 _weight)
    {
        _amount = epochProviderUnclaimedRewardAmount[_rewardEpoch][_dataProvider];
        _weight = epochProviderUnclaimedRewardWeight[_rewardEpoch][_dataProvider];
    }

    /**
     * @notice Returns the information on claimed reward of `_dataProvider` for `_rewardEpoch` by `_claimer`
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing the data provider
     * @param _claimer              address representing the claimer
     * @return _claimed             boolean indicating if reward has been claimed
     * @return _amount              number representing the claimed amount
     */
    function getClaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider,
        address _claimer
    )
        external view override 
        returns(bool _claimed, uint256 _amount) 
    {
        RewardClaim storage rewardClaim = epochProviderClaimerReward[_rewardEpoch][_dataProvider][_claimer];
        _claimed = rewardClaim.claimed;
        _amount = rewardClaim.amount;
    }

    /**
     * @notice Returns the current fee percentage of `_dataProvider`
     * @param _dataProvider         address representing data provider
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider) external view override returns (uint256) {
        return _getDataProviderFeePercentage(_dataProvider, getCurrentRewardEpoch());
    }

    /**
     * @notice Returns the fee percentage of `_dataProvider` at `_rewardEpoch`
     * @param _dataProvider         address representing data provider
     * @param _rewardEpoch          reward epoch number
     */
    function getDataProviderFeePercentage(
        address _dataProvider,
        uint256 _rewardEpoch
    )
        external view override
        returns (uint256 _feePercentageBIPS)
    {
        require(getInitialRewardEpoch() <= _rewardEpoch && 
            _rewardEpoch <= getCurrentRewardEpoch().add(feePercentageUpdateOffset),
            "invalid reward epoch");
        return _getDataProviderFeePercentage(_dataProvider, _rewardEpoch);
    }

    /**
     * @notice Returns the scheduled fee percentage changes of `_dataProvider`
     * @param _dataProvider         address representing data provider
     * @return _feePercentageBIPS   positional array of fee percentages in BIPS
     * @return _validFromEpoch      positional array of block numbers the fee setings are effective from
     * @return _fixed               positional array of boolean values indicating if settings are subjected to change
     */
    function getDataProviderScheduledFeePercentageChanges(
        address _dataProvider
    )
        external view override
        returns (
            uint256[] memory _feePercentageBIPS,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        ) 
    {
        FeePercentage[] storage fps = dataProviderFeePercentages[_dataProvider];
        if (fps.length > 0) {
            uint256 currentEpoch = getCurrentRewardEpoch();
            uint256 position = fps.length;
            while (position > 0 && fps[position - 1].validFromEpoch > currentEpoch) {
                position--;
            }
            uint256 count = fps.length - position;
            if (count > 0) {
                _feePercentageBIPS = new uint256[](count);
                _validFromEpoch = new uint256[](count);
                _fixed = new bool[](count);
                for (uint256 i = 0; i < count; i++) {
                    _feePercentageBIPS[i] = fps[i + position].value;
                    _validFromEpoch[i] = fps[i + position].validFromEpoch;
                    _fixed[i] = (_validFromEpoch[i] - currentEpoch) != feePercentageUpdateOffset;
                }
            }
        }        
    }

    /**
     * @notice Return reward epoch that will expire, when new reward epoch is initialized
     * @return Reward epoch id that will expire next
     */
    function getRewardEpochToExpireNext() external view override returns (uint256) {
        return nextRewardEpochToExpire;
    }

    /**
     * @notice Return token pool supply data
     * @return _lockedFundsWei                  Foundation locked funds (wei)
     * @return _totalInflationAuthorizedWei     Total inflation authorized amount (wei)
     * @return _totalClaimedWei                 Total claimed amount (wei)
     */
    function getTokenPoolSupplyData() external view override 
        returns (
            uint256 _lockedFundsWei,
            uint256 _totalInflationAuthorizedWei,
            uint256 _totalClaimedWei
        )
    {
        return (0, totalInflationAuthorizedWei, totalClaimedWei.add(totalBurnedWei));
    }

    /**
     * @notice Implement this function for updating inflation receiver contracts through AddressUpdater.
     */
    function getContractName() external pure override returns (string memory) {
        return "FtsoRewardManager";
    }

    /**
     * @notice Return reward epoch vote power block
     * @param _rewardEpoch          reward epoch number
     */
    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) public view override returns (uint256) {
        return ftsoManager.getRewardEpochVotePowerBlock(_rewardEpoch);
    }

    /**
     * @notice Return current reward epoch number
     */
    function getCurrentRewardEpoch() public view override returns (uint256) {
        return ftsoManager.getCurrentRewardEpoch();
    }

    /**
     * @notice Return initial reward epoch number
     * @return _initialRewardEpoch                 initial reward epoch number
     */
    function getInitialRewardEpoch() public view override returns (uint256 _initialRewardEpoch) {
        (, _initialRewardEpoch) = initialRewardEpoch.trySub(1);
    }

    function _handleSelfDestructProceeds() internal returns (uint256 _currentBalance, uint256 _expectedBalance) {
        _expectedBalance = lastBalance.add(msg.value);
        _currentBalance = address(this).balance;
        if (_currentBalance > _expectedBalance) {
            // Then assume extra were self-destruct proceeds
            totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(_currentBalance).sub(_expectedBalance);
        } else if (_currentBalance < _expectedBalance) {
            // This is a coding error
            assert(false);
        }
    }

    /**
     * @notice Burn rewards if there are any pending to burn, up to the maximum allowable.
     * @dev This is meant to be called once per day, right after inflation is received.
     *      There is a max allowable pct to burn so that the contract does not run out
     *      of funds for rewarding.
     */
    function _burnUnearnedRewards() internal {
        // Are there any rewards to burn?
        uint256 rewardsToBurnWei = totalUnearnedWei.add(totalExpiredWei).sub(totalBurnedWei);

        if (rewardsToBurnWei > 0) {
            // Calculate max rewards that can be burned
            uint256 maxToBurnWei = address(this).balance.mulDiv(MAX_BURNABLE_PCT, 100);

            uint256 toBurnWei = 0;
            // Calculate what we will burn
            if (rewardsToBurnWei > maxToBurnWei) {
                toBurnWei = maxToBurnWei;
            } else {
                toBurnWei = rewardsToBurnWei;
            }

            // Any to burn?
            if (toBurnWei > 0) {
                // Get the burn address; make it payable
                address payable burnAddress = payable(supply.burnAddress());

                // Accumulate what we are about to burn
                totalBurnedWei = totalBurnedWei.add(toBurnWei);

                // Update lastBalance before transfer, to avoid reentrancy warning 
                // (though there can not be any reentrancy due to transfer(0) or die() on known contract)
                lastBalance = lastBalance.sub(toBurnWei);

                // Burn baby burn
                UnearnedRewardBurner unearnedRewardBurner = new UnearnedRewardBurner(burnAddress);
                //slither-disable-next-line arbitrary-send
                address(unearnedRewardBurner).transfer(toBurnWei);
                unearnedRewardBurner.die();

                // Emit event to signal what we did
                emit RewardsBurned(toBurnWei);
            }
        }
    }

    /**
     * @notice Allows a percentage delegator to claim rewards.
     * @notice This function is intended to be used to claim rewards in case of delegation by percentage.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Reverts if `msg.sender` is delegating by amount
     */
    function _claimOrWrapReward(
        address _rewardOwner,
        address payable _recipient,
        uint256[] memory _rewardEpochs,
        bool _wrap
    ) 
        internal
        returns (uint256 _rewardAmount)
    {
        _handleSelfDestructProceeds();

        uint256 currentRewardEpoch = getCurrentRewardEpoch();
                
        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState = _getStateOfRewards(_rewardOwner, _rewardEpochs[i], true);
            uint256 amount = _claimReward(_rewardOwner, _recipient, _rewardEpochs[i], rewardState);
            claimedRewardEpochRewards[_rewardEpochs[i]] += amount;
            _rewardAmount += amount;
        }

        if (_wrap) {
            _sendWrappedRewardTo(_recipient, _rewardAmount);
        } else {
            _transferReward(_recipient, _rewardAmount);
        }

        //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant
        lastBalance = address(this).balance;
    }

    /**
     * @notice Allows the sender to claim the rewards from specified data providers.
     * @notice This function is intended to be used to claim rewards in case of delegation by amount.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpochs         array of reward epoch numbers to claim for
     * @param _dataProviders        array of addresses representing data providers to claim the reward from
     * @param _wrap                 should reward be wrapped immediatelly
     * @return _rewardAmount        amount of total claimed rewards
     * @dev Function can be used by a percentage delegator but is more gas consuming than `claimReward`.
     */
    function _claimOrWrapRewardFromDataProviders(
        address _rewardOwner,
        address payable _recipient,
        uint256[] memory _rewardEpochs,
        address[] memory _dataProviders,
        bool _wrap
    )
        internal
        returns (uint256 _rewardAmount)
    {
        _handleSelfDestructProceeds();

        uint256 currentRewardEpoch = getCurrentRewardEpoch();

        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState;
            rewardState = _getStateOfRewardsFromDataProviders(_rewardOwner, _rewardEpochs[i], _dataProviders, true);

            uint256 amount = _claimReward(_rewardOwner, _recipient, _rewardEpochs[i], rewardState);
            claimedRewardEpochRewards[_rewardEpochs[i]] += amount;
            _rewardAmount += amount;
        }

        if (_wrap) {
            _sendWrappedRewardTo(_recipient, _rewardAmount);
        } else {
            _transferReward(_recipient, _rewardAmount);
        }
        
        //slither-disable-next-line reentrancy-eth      // guarded by nonReentrant
        lastBalance = address(this).balance;
    }

    /**
     * @notice Claims `_rewardAmounts` for `_dataProviders`.
     * @dev Internal function that takes care of reward bookkeeping
     * @param _recipient            address representing the recipient of the reward
     * @param _rewardEpoch          reward epoch number
     * @param _rewardState          object holding reward state
     * @return Returns the total reward amount.
     */
    function _claimReward(
        address _rewardOwner,
        address payable _recipient,
        uint256 _rewardEpoch,
        RewardState memory _rewardState
    ) 
        internal
        returns (uint256)
    {
        uint256 totalRewardAmount = 0;
        for (uint256 i = 0; i < _rewardState.dataProviders.length; i++) {
            if (_rewardState.claimed[i]) {
                continue;
            }

            address dataProvider = _rewardState.dataProviders[i];            

            uint256 rewardWeight = _rewardState.weights[i];            
            if (rewardWeight > 0) {
                epochProviderUnclaimedRewardWeight[_rewardEpoch][dataProvider] -= rewardWeight; // can not underflow
            }

            uint256 rewardAmount = _rewardState.amounts[i];
            if (rewardAmount > 0) {
                epochProviderUnclaimedRewardAmount[_rewardEpoch][dataProvider] -= rewardAmount; // can not underflow
                totalClaimedWei += rewardAmount;
                totalRewardAmount += rewardAmount;
            }

            RewardClaim storage rewardClaim = epochProviderClaimerReward[_rewardEpoch][dataProvider][_rewardOwner];
            rewardClaim.claimed = true;
            rewardClaim.amount = rewardAmount;

            emit RewardClaimed({
                dataProvider: dataProvider,
                whoClaimed: _rewardOwner,
                sentTo: _recipient,
                rewardEpoch: _rewardEpoch,
                amount: rewardAmount
            });
        }

        return totalRewardAmount;
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

    /**
     * @notice Wrap (deposit) `_rewardAmount` to `_recipient` on WNat.
     * @param _recipient            address representing the reward recipient
     * @param _rewardAmount         number representing the amount to transfer
     */
    function _sendWrappedRewardTo(address payable _recipient, uint256 _rewardAmount) internal {
        if (_rewardAmount > 0) {
            // transfer total amount (state is updated and events are emitted in _claimReward)
            //slither-disable-next-line arbitrary-send          // amount always calculated by _claimReward
            wNat.depositTo{value: _rewardAmount}(_recipient);
        }
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        inflation = _getContractAddress(_contractNameHashes, _contractAddresses, "Inflation");
        ftsoManager = IIFtsoManager(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoManager"));
        wNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
        supply = Supply(_getContractAddress(_contractNameHashes, _contractAddresses, "Supply"));
    }

    function _getDistributableFtsoInflationBalance() internal view returns (uint256) {
        return totalInflationAuthorizedWei
            .sub(totalAwardedWei)
            .sub(totalUnearnedWei);
    }

    function _getRemainingPriceEpochCount(
        uint256 _fromThisTs, 
        uint256 _priceEpochDurationSeconds
    )
        internal view
        returns (uint256)
    {
        // Get the end of the daily period
        uint256 dailyPeriodEndTs = lastInflationAuthorizationReceivedTs.add(ALMOST_SEVEN_FULL_DAYS_SEC);
        require(_fromThisTs <= dailyPeriodEndTs, ERR_AFTER_DAILY_CYCLE);
        return dailyPeriodEndTs.sub(_fromThisTs).div(_priceEpochDurationSeconds) + 1;
    }

    /**
     * @notice Returns the reward to distribute for a given price epoch.
     * @param _priceEpochDurationSeconds    Number of seconds for a price epoch.
     * @param _priceEpochEndTime            Datetime stamp of the end of the price epoch
     * @return                              Price epoch reward in wei
     * @dev Based on a daily distribution and period.
     */
    function _getTotalPriceEpochRewardWei(
        uint256 _priceEpochDurationSeconds,
        uint256 _priceEpochEndTime // end time included in epoch
    )
        internal view 
        returns (uint256)
    {
        return 
            _getDistributableFtsoInflationBalance()
            .div(_getRemainingPriceEpochCount(_priceEpochEndTime, _priceEpochDurationSeconds));
    }

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch`.
     * @dev Internal function
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @param _zeroForClaimed       boolean value that enables skipping amount computation for claimed rewards
     * @return _rewardState         object holding reward state
     * @dev Reverts when queried with `_beneficary` delegating by amount.
     */
    function _getStateOfRewards(
        address _beneficiary,
        uint256 _rewardEpoch,
        bool _zeroForClaimed
    )
        internal view 
        returns (RewardState memory _rewardState)
    {
        uint256 votePowerBlock = getRewardEpochVotePowerBlock(_rewardEpoch);
        
        // setup for data provider reward
        bool dataProviderClaimed = _isRewardClaimed(_rewardEpoch, _beneficiary, _beneficiary);
        
        // gather data provider reward info
        uint256 dataProviderRewardWeight;
        RewardClaim memory dataProviderReward;
        if (dataProviderClaimed) {
            if (!_zeroForClaimed) {
                // weight is irrelevant
                dataProviderReward.amount = _getClaimedReward(_rewardEpoch, _beneficiary, _beneficiary);
            }
        } else {
            dataProviderRewardWeight = _getRewardWeightForDataProvider(_beneficiary, _rewardEpoch, votePowerBlock);
            dataProviderReward.amount = _getRewardAmount(_rewardEpoch, _beneficiary, dataProviderRewardWeight);
        }
        // flag if data is to be included
        dataProviderReward.claimed = dataProviderClaimed || dataProviderReward.amount > 0;

        // setup for delegation rewards
        address[] memory delegates;
        uint256[] memory bips;
        (delegates, bips, , ) = wNat.delegatesOfAt(_beneficiary, votePowerBlock);
        
        // reward state setup
        _rewardState.dataProviders = new address[]((dataProviderReward.claimed ? 1 : 0) + delegates.length);
        _rewardState.weights = new uint256[](_rewardState.dataProviders.length);
        _rewardState.amounts = new uint256[](_rewardState.dataProviders.length);
        _rewardState.claimed = new bool[](_rewardState.dataProviders.length);

        // data provider reward
        if (dataProviderReward.claimed) {
            _rewardState.dataProviders[0] = _beneficiary;
            _rewardState.claimed[0] = dataProviderClaimed;
            _rewardState.weights[0] = dataProviderRewardWeight;
            _rewardState.amounts[0] = dataProviderReward.amount;            
        }

        // delegation rewards
        if (delegates.length > 0) {
            uint256 delegatorBalance = wNat.balanceOfAt(_beneficiary, votePowerBlock);
            for (uint256 i = 0; i < delegates.length; i++) {
                uint256 p = (dataProviderReward.claimed ? 1 : 0) + i;
                _rewardState.dataProviders[p] = delegates[i];
                _rewardState.claimed[p] = _isRewardClaimed(_rewardEpoch, delegates[i], _beneficiary);
                if (_rewardState.claimed[p]) {
                    if (!_zeroForClaimed) {
                        // weight is irrelevant
                        _rewardState.amounts[p] = _getClaimedReward(_rewardEpoch, delegates[i], _beneficiary);
                    }
                } else {
                    _rewardState.weights[p] = _getRewardWeightForDelegator(
                        delegates[i],
                        delegatorBalance.mulDiv(bips[i], MAX_BIPS),
                        _rewardEpoch
                    );
                    _rewardState.amounts[p] = _getRewardAmount(
                        _rewardEpoch,
                        delegates[i],
                        _rewardState.weights[p]
                    );
                }
            }
        }
    }

    /**
     * @notice Returns the state of rewards for `_beneficiary` at `_rewardEpoch` from `_dataProviders`
     * @param _beneficiary          address of reward beneficiary
     * @param _rewardEpoch          reward epoch number
     * @param _dataProviders        positional array of addresses representing data providers
     * @param _zeroForClaimed       boolean value that enables skipping amount computation for claimed rewards
     * @return _rewardState         object holding reward state
     */
    function _getStateOfRewardsFromDataProviders(
        address _beneficiary,
        uint256 _rewardEpoch,
        address[] memory _dataProviders,
        bool _zeroForClaimed
    )
        internal view 
        returns (RewardState memory _rewardState) 
    {
        uint256 votePowerBlock = getRewardEpochVotePowerBlock(_rewardEpoch);

        uint256 count = _dataProviders.length;
        _rewardState.dataProviders = _dataProviders;
        _rewardState.weights = new uint256[](count);
        _rewardState.amounts = new uint256[](count);
        _rewardState.claimed = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            _rewardState.claimed[i] = _isRewardClaimed(_rewardEpoch, _dataProviders[i], _beneficiary);
            if (_rewardState.claimed[i]) {
                if (!_zeroForClaimed) {
                    // weight is irrelevant
                    _rewardState.amounts[i] = _getClaimedReward(_rewardEpoch, _dataProviders[i], _beneficiary);
                }
                continue;
            }

            if (_dataProviders[i] == _beneficiary) {
                _rewardState.weights[i] = _getRewardWeightForDataProvider(
                    _beneficiary,
                    _rewardEpoch,
                    votePowerBlock
                );
            } else {
                uint256 delegatedVotePower = wNat.votePowerFromToAt(_beneficiary, _dataProviders[i], votePowerBlock);
                _rewardState.weights[i] = _getRewardWeightForDelegator(
                    _dataProviders[i],
                    delegatedVotePower,
                    _rewardEpoch
                );
            }
            _rewardState.amounts[i] = _getRewardAmount(
                _rewardEpoch,
                _dataProviders[i],
                _rewardState.weights[i]
            );
        }
    }

    /**
     * @notice Reports if rewards for `_rewardEpoch` are claimable.
     * @param _rewardEpoch          reward epoch number
     * @param _currentRewardEpoch   number of the current reward epoch
     */
    function _isRewardClaimable(uint256 _rewardEpoch, uint256 _currentRewardEpoch) internal view returns (bool) {
        if (_rewardEpoch < nextRewardEpochToExpire || _rewardEpoch >= _currentRewardEpoch) {
            // reward expired and closed or current or future
            return false;
        }
        return true;
    }

    /**
     * @notice Returns the start and the end of the reward epoch range for which the reward is claimable
     * @return _startEpochId        the oldest epoch id that allows reward claiming
     * @return _endEpochId          the newest epoch id that allows reward claiming
     */
    function _getEpochsWithClaimableRewards() internal view 
        returns (
            uint256 _startEpochId,
            uint256 _endEpochId
        ) 
    {
        _startEpochId = nextRewardEpochToExpire;
        uint256 currentRewardEpochId = getCurrentRewardEpoch();
        require(currentRewardEpochId > 0, ERR_NO_CLAIMABLE_EPOCH);        
        _endEpochId = currentRewardEpochId - 1;
    }

    /**
     * @notice Reports if reward at `_rewardEpoch` for `_dataProvider` has already been claimed by `_claimer`.
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing a data provider
     * @param _claimer              address representing a reward claimer
     */
    function _isRewardClaimed(
        uint256 _rewardEpoch,
        address _dataProvider,
        address _claimer
    )
        internal view
        returns (bool)
    {
        return epochProviderClaimerReward[_rewardEpoch][_dataProvider][_claimer].claimed;
    }

    /**
     * @notice Returns the reward amount at `_rewardEpoch` for `_dataProvider` claimed by `_claimer`.
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing a data provider
     * @param _claimer              address representing a reward claimer
     */
    function _getClaimedReward(
        uint256 _rewardEpoch,
        address _dataProvider,
        address _claimer
    )
        internal view
        returns (uint256)
    {
        return epochProviderClaimerReward[_rewardEpoch][_dataProvider][_claimer].amount;
    }

    /**
     * @notice Returns the reward amount for `_dataProvider` at `_rewardEpoch`
     * @param _rewardEpoch          reward epoch number
     * @param _dataProvider         address representing a data provider     
     * @param _rewardWeight         number representing reward weight
     */
    function _getRewardAmount(
        uint256 _rewardEpoch,
        address _dataProvider,
        uint256 _rewardWeight
    )
        internal view
        returns (uint256)
    {
        if (_rewardWeight == 0) {
            return 0;
        }
        uint256 unclaimedRewardAmount = epochProviderUnclaimedRewardAmount[_rewardEpoch][_dataProvider];
        if (unclaimedRewardAmount == 0) {
            return 0;
        }
        uint256 unclaimedRewardWeight = epochProviderUnclaimedRewardWeight[_rewardEpoch][_dataProvider];
        if (_rewardWeight == unclaimedRewardWeight) {
            return unclaimedRewardAmount;
        }
        assert(_rewardWeight < unclaimedRewardWeight);
        return unclaimedRewardAmount.mulDiv(_rewardWeight, unclaimedRewardWeight);
    }

    /**
     * @notice Returns reward weight for `_dataProvider` at `_rewardEpoch`
     * @param _dataProvider         address representing a data provider
     * @param _rewardEpoch          reward epoch number
     * @param _votePowerBlock       block number used to determine the vote power for reward computation
     */
    function _getRewardWeightForDataProvider(
        address _dataProvider,
        uint256 _rewardEpoch,
        uint256 _votePowerBlock
    )
        internal view
        returns (uint256)
    {
        uint256 dataProviderVotePower = wNat.undelegatedVotePowerOfAt(_dataProvider, _votePowerBlock);
        uint256 votePower = wNat.votePowerOfAt(_dataProvider, _votePowerBlock);

        if (dataProviderVotePower == votePower) {
            // shortcut, but also handles (unlikely) zero vote power case
            return votePower.mul(MAX_BIPS);
        }
        assert(votePower > dataProviderVotePower);

        uint256 rewardWeight = 0;

        // weight share based on data provider undelagated vote power
        if (dataProviderVotePower > 0) {
            rewardWeight += dataProviderVotePower.mul(MAX_BIPS);
        }

        // weight share based on data provider fee
        uint256 feePercentageBIPS = _getDataProviderFeePercentage(_dataProvider, _rewardEpoch);
        if (feePercentageBIPS > 0) {
            rewardWeight += (votePower - dataProviderVotePower).mul(feePercentageBIPS);
        }

        return rewardWeight;
    }

    /**
     * @notice Returns reward weight at `_rewardEpoch` for delegator delegating `_delegatedVotePower` to `_delegate`.
     * @param _delegate             address representing a delegate (data provider)
     * @param _delegatedVotePower   number representing vote power delegated by delegator
     * @param _rewardEpoch          reward epoch number
     */
    function _getRewardWeightForDelegator(        
        address _delegate,
        uint256 _delegatedVotePower,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint256)
    {
        if (_delegatedVotePower == 0) {
            return 0;
        }

        uint256 rewardWeight = 0;

        // reward weight determined by vote power share
        uint256 feePercentageBIPS = _getDataProviderFeePercentage(_delegate, _rewardEpoch);
        if (feePercentageBIPS < MAX_BIPS) {
            rewardWeight += _delegatedVotePower.mul(MAX_BIPS - feePercentageBIPS);
        }

        return rewardWeight;
    }

    /**
     * @notice Returns fee percentage setting for `_dataProvider` at `_rewardEpoch`.
     * @param _dataProvider         address representing a data provider
     * @param _rewardEpoch          reward epoch number
     */
    function _getDataProviderFeePercentage(
        address _dataProvider,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint256)
    {
        FeePercentage[] storage fps = dataProviderFeePercentages[_dataProvider];
        uint256 index = fps.length;
        while (index > 0) {
            index--;
            if (_rewardEpoch >= fps[index].validFromEpoch) {
                return fps[index].value;
            }
        }
        return defaultFeePercentage;
    }

    function _getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return totalInflationReceivedWei
            .add(totalSelfDestructReceivedWei)
            .sub(totalClaimedWei)
            .sub(totalBurnedWei);
    }
}
