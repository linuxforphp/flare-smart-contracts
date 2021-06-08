// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIFtsoRewardManager.sol";
import "../../governance/implementation/Governed.sol";
import "../../token/implementation/WFlr.sol";
import "../../utils/implementation/SafePct.sol";
import { Inflation } from "../../inflation/implementation/Inflation.sol";
import "../../accounting/interface/IIRewardManager.sol";
import { IIInflationReceiver } from "../../inflation/interface/IIInflationReceiver.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

//import "hardhat/console.sol";

/**
 * FTSORewardManager is in charge of:
 * - distributing rewards according to instructions from FTSO Manager
 * - allowing claims for rewards
 */    

//solhint-disable-next-line max-states-count
contract FtsoRewardManager is IIFtsoRewardManager, IIInflationReceiver, IIRewardManager, Governed, ReentrancyGuard {
    using SafePct for uint256;
    using SafeMath for uint256;

    struct FeePercentage {          // used for storing data provider fee percentage settings
        uint16 value;               // fee percentage value (value between 0 and 1e4)
        uint240 validFromEpoch;     // id of the reward epoch from which the value is valid
    }
    struct RewardState {            // used for local storage of reward state
        address[] dataProviders;    // positional array of addresses representing data providers
        uint256[] rewardAmounts;    // positional array of numbers representing reward amount
        bool[] claimed;             // positional array of booleans indicating if reward has already been claimed
    }

    string internal constant ERR_FTSO_MANAGER_ONLY = "ftso manager only";
    string internal constant ERR_INFLATION_ONLY = "inflation only";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_SUPPLY_ZERO = "supply zero";
    string internal constant ERR_FTSO_MANAGER_ZERO = "no ftso manager";
    string internal constant ERR_WFLR_ZERO = "no wflr";
    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_CLAIM_FAILED = "claim failed";
    string internal constant ERR_REWARD_MANAGER_DEACTIVATED = "reward manager deactivated";
    string internal constant ERR_FEE_PERCENTAGE_INVALID = "invalid fee percentage value";
    string internal constant ERR_FEE_PERCENTAGE_UPDATE_FAILED = "fee percentage can not be updated";
    string internal constant ERR_AFTER_DAILY_CYCLE = "after daily cycle";
    
    uint256 constant internal MAX_BIPS = 1e4;
    uint256 constant internal ALMOST_FULL_DAY_SEC = 86399;

    bool internal active;

    uint256 internal immutable feePercentageUpdateOffset; // fee percentage update timelock measured in reward epochs
    uint256 public immutable defaultFeePercentage; // default value for fee percentage
    
    uint256 public immutable rewardExpiryOffset; // period of reward expiry (in reward epochs)
    
    // id of the first epoch to expire. Closed = expired and unclaimed funds sent back
    uint256 private firstEpochToCheckExpiry; 
    
    /**
     * @dev Provides a mapping of reward epoch ids to an address mapping of unclaimed rewards.
     */
    mapping(uint256 => mapping(address => uint256)) public unclaimedRewardsPerRewardEpoch;
    mapping(uint256 => mapping(address => uint256)) public totalRewardsPerRewardEpoch;
    mapping(uint256 => mapping(address => mapping(address => bool))) public rewardClaimed;
    mapping(uint256 => uint256) public totalRewardEpochRewards;
    mapping(uint256 => uint256) public claimedRewardEpochRewards;

    mapping(address => FeePercentage[]) public dataProviderFeePercentages;

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
    IIFtsoManager public ftsoManager;
    Inflation public inflation;
    Supply public supply;

    WFlr public wFlr; 

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
        require(msg.sender == address(inflation), ERR_INFLATION_ONLY);
        _;
    }

    constructor(
        address _governance,
        uint256 _feePercentageUpdateOffset,
        uint256 _defaultFeePercentage,
        uint256 _rewardExpiryOffset,
        Inflation _inflation,
        Supply _supply
    ) Governed(_governance)
    {
        require(address(_inflation) != address(0), ERR_INFLATION_ZERO);
        require(address(_supply) != address(0), ERR_SUPPLY_ZERO);

        inflation = _inflation;
        supply = _supply;
        feePercentageUpdateOffset = _feePercentageUpdateOffset;
        defaultFeePercentage = _defaultFeePercentage;
        rewardExpiryOffset = _rewardExpiryOffset;
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
    ) external override onlyIfActive mustBalance nonReentrant returns (
        uint256 _rewardAmount
    ) {
        _handleSelfDestructProceeds();

        uint256 currentRewardEpoch = ftsoManager.getCurrentRewardEpoch();
                
        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState = _getStateOfRewards(msg.sender, _rewardEpochs[i], true);
            uint256 amount = _claimReward(_recipient, _rewardEpochs[i], rewardState);
            claimedRewardEpochRewards[_rewardEpochs[i]] += amount;
            _rewardAmount += amount;
        }

        _transferReward(_recipient, _rewardAmount);

        lastBalance = address(this).balance;
    }

    /**
     * @notice Allows the sender to claim the rewards from specified data providers.
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
    ) external override onlyIfActive mustBalance nonReentrant returns (
        uint256 _rewardAmount
    ) {
        _handleSelfDestructProceeds();

        uint256 currentRewardEpoch = ftsoManager.getCurrentRewardEpoch();

        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState;
            rewardState = _getStateOfRewardsFromDataProviders(msg.sender, _rewardEpochs[i], _dataProviders, true);

            uint256 amount = _claimReward(_recipient, _rewardEpochs[i], rewardState);
            claimedRewardEpochRewards[_rewardEpochs[i]] += amount;
            _rewardAmount += amount;
        }

        _transferReward(_recipient, _rewardAmount);

        lastBalance = address(this).balance;
    }

    /**
     * @notice Activates reward manager (allows claiming rewards)
     */
    function activate() external override onlyGovernance {
        require(address(ftsoManager) != address(0), ERR_FTSO_MANAGER_ZERO);
        require(address(wFlr) != address(0), ERR_WFLR_ZERO);
        active = true;
    }

    /**
     * @notice Deactivates reward manager (prevents claiming rewards)
     */
    function deactivate() external override onlyGovernance {
        active = false;
    }
   
    /**
     * @notice sets FTSO manager corresponding to the reward manager
     */
    function setFTSOManager(IIFtsoManager _ftsoManager) external override onlyGovernance {
        require(address(_ftsoManager) != address(0), ERR_FTSO_MANAGER_ZERO);
        ftsoManager = _ftsoManager;
    }

    /**
     * @notice Sets inflation contract
     */
    function setInflation(Inflation _inflation) external onlyGovernance {
        require(address(_inflation) != address(0), ERR_INFLATION_ZERO);
        inflation = _inflation;
    }

    
    /**
     * @notice Sets supply contract
     */
    function setSupply(Supply _supply) external override onlyGovernance {
        require(address(_supply) != address(0), ERR_SUPPLY_ZERO);
        supply = _supply;
    }

    /**
     * @notice Sets WFlr token.
     */
    function setWFLR(WFlr _wFlr) external override onlyGovernance {
        require(address(_wFlr) != address(0), ERR_WFLR_ZERO);
        wFlr = _wFlr;
    }

    function setDailyAuthorizedInflation(uint256 _toAuthorizeWei) external override onlyInflation {
        dailyAuthorizedInflation = _toAuthorizeWei;
        totalInflationAuthorizedWei = totalInflationAuthorizedWei.add(_toAuthorizeWei);
        lastInflationAuthorizationReceivedTs = block.timestamp;
        // TODO: event

        // update supply contract with new data
        supply.updateRewardManagerData(totalInflationAuthorizedWei, totalClaimedWei);
    }

    function receiveInflation() external payable override mustBalance onlyInflation {
        (uint256 currentBalance, uint256  expectedBalance ) = _handleSelfDestructProceeds();
        if (currentBalance > expectedBalance) {
            // Extra were self-destruct proceeds; already taken care of
            totalInflationReceivedWei = totalInflationReceivedWei.add(expectedBalance);
        } else if (currentBalance == expectedBalance) {
            totalInflationReceivedWei = totalInflationReceivedWei.add(msg.value);
        } else {
            assert(false);
        }
        lastBalance = currentBalance;
        // TODO: fire event
    }

    /**
     *   @notice Distributes rewards to data providers accounts, according to input parameters.
     *   @dev must be called with totalWeight > 0 and addresses.length > 0
     */
    function distributeRewards(
        address[] memory _addresses,
        uint256[] memory _weights,
        uint256 _totalWeight,
        uint256 _epochId,
        address _ftso,
        uint256 _priceEpochDurationSec,
        uint256 _currentRewardEpoch,
        uint256 _priceEpochEndTime
    ) external override onlyFtsoManager {
        // FTSO manager should never call with bad values.
        assert (_totalWeight != 0 && _addresses.length != 0);        

        // console.log("_getDistributableFtsoInflationBalance() = ", _getDistributableFtsoInflationBalance());
        // console.log("count = ", _getRemainingPriceEpochCount(_priceEpochEndTime, _priceEpochDurationSec));
        uint256 totalPriceEpochReward = 
            _getDistributableFtsoInflationBalance()
            .div(_getRemainingPriceEpochCount(_priceEpochEndTime, _priceEpochDurationSec));
        // console.log("totalPriceEpochReward = ", totalPriceEpochReward);
        uint256 currentDistributedSoFar = 0;

        uint256[] memory rewards = new uint256[](_addresses.length);

        for (uint i = _addresses.length - 1; i > 0; i--) {
            uint256 rewardAmount = totalPriceEpochReward * _weights[i] / _totalWeight;
            currentDistributedSoFar += rewardAmount;
            rewards[i] = rewardAmount;
            unclaimedRewardsPerRewardEpoch[_currentRewardEpoch][_addresses[i]] +=
                rewardAmount;
            totalRewardsPerRewardEpoch[_currentRewardEpoch][_addresses[i]] +=
                rewardAmount;
        }

        // give remaining amount to last address.
        unclaimedRewardsPerRewardEpoch[_currentRewardEpoch][_addresses[0]] += 
            totalPriceEpochReward - currentDistributedSoFar;
        totalRewardsPerRewardEpoch[_currentRewardEpoch][_addresses[0]] +=
            totalPriceEpochReward - currentDistributedSoFar;
        rewards[0] = totalPriceEpochReward - currentDistributedSoFar;

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

        uint256 rewardEpoch = ftsoManager.getCurrentRewardEpoch() + feePercentageUpdateOffset;
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
     * @notice Collects funds from expired reward epochs and totals.
     * @dev Triggered by ftsoManager on finalization of a reward epoch.
     */
    function closeExpiredRewardEpochs() external override onlyFtsoManager {
        uint256 expiredRewards = 0;
        uint256 current = ftsoManager.getCurrentRewardEpoch();
        while(firstEpochToCheckExpiry < current && !_isRewardClaimable(firstEpochToCheckExpiry, current)) {
            expiredRewards += 
                totalRewardEpochRewards[firstEpochToCheckExpiry] - 
                claimedRewardEpochRewards[firstEpochToCheckExpiry];
            emit RewardClaimsExpired(firstEpochToCheckExpiry);
            firstEpochToCheckExpiry++;
        }
        totalExpiredWei = totalExpiredWei.add(expiredRewards);
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
    ) external view override returns (
        address[] memory _dataProviders,
        uint256[] memory _rewardAmounts,
        bool[] memory _claimed,
        bool _claimable
    ) {
        RewardState memory rewardState = _getStateOfRewards(_beneficiary, _rewardEpoch, false);
        _dataProviders = rewardState.dataProviders;
        _rewardAmounts = rewardState.rewardAmounts;
        _claimed = rewardState.claimed;
        _claimable = _isRewardClaimable(_rewardEpoch, ftsoManager.getCurrentRewardEpoch());
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
    ) external view override returns (
        uint256[] memory _rewardAmounts,
        bool[] memory _claimed,
        bool _claimable
    ) {
        RewardState memory rewardState = _getStateOfRewardsFromDataProviders(
            _beneficiary,
            _rewardEpoch,
            _dataProviders,
            false
        );
        _rewardAmounts = rewardState.rewardAmounts;
        _claimed = rewardState.claimed;
        _claimable = _isRewardClaimable(_rewardEpoch, ftsoManager.getCurrentRewardEpoch());
    }

    /**
     * @notice Returns the current fee percentage of `_dataProvider`
     * @param _dataProvider         address representing data provider
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider) external view override returns (uint256) {
        return _getDataProviderFeePercentage(_dataProvider, ftsoManager.getCurrentRewardEpoch());
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
    ) external view override returns (
        uint256[] memory _feePercentageBIPS,
        uint256[] memory _validFromEpoch,
        bool[] memory _fixed
    ) {
        FeePercentage[] storage fps = dataProviderFeePercentages[_dataProvider];
        if (fps.length > 0) {
            uint256 currentEpoch = ftsoManager.getCurrentRewardEpoch();
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
        uint256 current = ftsoManager.getCurrentRewardEpoch();
        if (current > rewardExpiryOffset) {
            return current - rewardExpiryOffset;
        }
        return 0;
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
     * @notice Claims `_rewardAmounts` for `_dataProviders`.
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
    ) internal returns (uint256)
    {
        uint256 totalRewardAmount = 0;
        for (uint256 i = 0; i < _rewardState.dataProviders.length; i++) {
            if (_rewardState.claimed[i]) {
                continue;
            }
            address dataProvider = _rewardState.dataProviders[i];
            uint256 rewardAmount = _rewardState.rewardAmounts[i];

            rewardClaimed[_rewardEpoch][dataProvider][msg.sender] = true;
            
            if (rewardAmount > 0) {
                assert(unclaimedRewardsPerRewardEpoch[_rewardEpoch][dataProvider] >= rewardAmount); // sanity check
                unclaimedRewardsPerRewardEpoch[_rewardEpoch][dataProvider] -= rewardAmount;
                totalClaimedWei += rewardAmount;
                totalRewardAmount += rewardAmount;
            }

            emit RewardClaimed({
                dataProvider: dataProvider,
                whoClaimed: msg.sender,
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
            (bool success, ) = _recipient.call{value: _rewardAmount}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_CLAIM_FAILED);
        }
    }

    function _getDistributableFtsoInflationBalance() internal view returns (uint256) {
        return totalInflationAuthorizedWei
            .sub(totalAwardedWei.sub(totalExpiredWei));
    }

    function _getRemainingPriceEpochCount(
        uint256 _fromThisTs, 
        uint256 _priceEpochDurationSec
    )
        internal view
        returns (uint256)
    {
        // Get the end of the daily period
        uint256 dailyPeriodEndTs = lastInflationAuthorizationReceivedTs.add(ALMOST_FULL_DAY_SEC);
        require(_fromThisTs <= dailyPeriodEndTs, ERR_AFTER_DAILY_CYCLE);
        return dailyPeriodEndTs.sub(_fromThisTs).div(_priceEpochDurationSec) + 1;
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
    ) internal view returns (RewardState memory _rewardState)
    {
        uint256 votePowerBlock = ftsoManager.getRewardEpochVotePowerBlock(_rewardEpoch);

        bool dataProviderClaimed = _isRewardClaimed(_rewardEpoch, _beneficiary, _beneficiary);
        uint256 dataProviderAmount = _getRewardAmountForDataProvider(_beneficiary, _rewardEpoch, votePowerBlock);
        uint256 dataProviderReward = (dataProviderClaimed || dataProviderAmount > 0) ? 1 : 0;

        address[] memory delegates;
        uint256[] memory bips;
        (delegates, bips, , ) = wFlr.delegatesOfAt(_beneficiary, votePowerBlock);
        
        _rewardState.dataProviders = new address[](dataProviderReward + delegates.length);
        _rewardState.rewardAmounts = new uint256[](dataProviderReward + delegates.length);
        _rewardState.claimed = new bool[](dataProviderReward + delegates.length);

        if (dataProviderReward == 1) {
            _rewardState.dataProviders[0] = _beneficiary;
            _rewardState.claimed[0] = dataProviderClaimed;
            _rewardState.rewardAmounts[0] = (_zeroForClaimed && dataProviderClaimed) ? 0 : dataProviderAmount;
        }

        if (delegates.length > 0) {
            uint256 delegatorBalance = wFlr.balanceOfAt(_beneficiary, votePowerBlock);
            for (uint256 i = 0; i < delegates.length; i++) {
                uint256 index = dataProviderReward + i;
                _rewardState.dataProviders[index] = delegates[i];
                _rewardState.claimed[index] = _isRewardClaimed(_rewardEpoch, delegates[i], _beneficiary);
                if (_rewardState.claimed[index] && _zeroForClaimed) {
                    continue;
                }
                _rewardState.rewardAmounts[index] = _getRewardAmountForDelegator(
                    delegates[i],
                    delegatorBalance.mulDiv(bips[i], MAX_BIPS),
                    _rewardEpoch,
                    votePowerBlock
                );
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
    ) internal view returns (RewardState memory _rewardState) {
        uint256 votePowerBlock = ftsoManager.getRewardEpochVotePowerBlock(_rewardEpoch);

        uint256 count = _dataProviders.length;
        _rewardState.dataProviders = _dataProviders;
        _rewardState.rewardAmounts = new uint256[](count);
        _rewardState.claimed = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            _rewardState.claimed[i] = _isRewardClaimed(_rewardEpoch, _dataProviders[i], _beneficiary);
            if (_rewardState.claimed[i] && _zeroForClaimed) {
                continue;
            }

            if (_dataProviders[i] == _beneficiary) {
                _rewardState.rewardAmounts[i] = _getRewardAmountForDataProvider(
                    _beneficiary,
                    _rewardEpoch,
                    votePowerBlock
                );
            } else {
                uint256 delegatedVotePower = wFlr.votePowerFromToAt(_beneficiary, _dataProviders[i], votePowerBlock);
                _rewardState.rewardAmounts[i] = _getRewardAmountForDelegator(
                    _dataProviders[i],
                    delegatedVotePower,
                    _rewardEpoch,
                    votePowerBlock
                );
            }
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
        if (_rewardEpoch >= _currentRewardEpoch) {
            // reward not ready for distribution
            return false;
        }
        return true;
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
    ) internal view returns (bool)
    {
        return rewardClaimed[_rewardEpoch][_dataProvider][_claimer];
    }

    /**
     * @notice Returns the reward amount for `_dataProvider` at `_rewardEpoch`
     * @param _dataProvider         address representing a data provider
     * @param _rewardEpoch          reward epoch number
     * @param _votePowerBlock       block number used to determine the vote power for reward computation
     */
    function _getRewardAmountForDataProvider(
        address _dataProvider,
        uint256 _rewardEpoch,
        uint256 _votePowerBlock
    ) internal view returns (uint256)
    {
        uint256 totalReward = totalRewardsPerRewardEpoch[_rewardEpoch][_dataProvider];
        if (totalReward == 0) {
            return 0;
        }

        uint256 dataProviderVotePower = wFlr.undelegatedVotePowerOfAt(_dataProvider, _votePowerBlock);
        uint256 votePower = wFlr.votePowerOfAt(_dataProvider, _votePowerBlock);

        if (dataProviderVotePower == votePower) {
            // shortcut, but also handles (unlikely) zero vote power case
            return totalReward;
        }
        assert(votePower > dataProviderVotePower);

        uint256 reward = 0;

        // data provider share (without fee)
        if (dataProviderVotePower > 0) {
            reward += totalReward.mulDiv(dataProviderVotePower, votePower);
        }

        // data provider fee (fee is taken from the total vote power delegated to data provider)
        uint256 feePercentageBIPS = _getDataProviderFeePercentage(_dataProvider, _rewardEpoch);
        if (feePercentageBIPS > 0) {
            reward += totalReward.mulDiv(
                (votePower - dataProviderVotePower).mul(feePercentageBIPS),
                votePower.mul(MAX_BIPS)
            );
        }

        return reward;
    }

    /**
     * @notice Returns reward amount at `_rewardEpoch` for delegator delegating `_delegatedVotePower` to `_delegate`.
     * @param _delegate             address representing a delegate (data provider)
     * @param _delegatedVotePower   number representing vote power delegated by delegator
     * @param _rewardEpoch          reward epoch number
     * @param _votePowerBlock       block number used to determine the vote power for reward computation
     */
    function _getRewardAmountForDelegator(        
        address _delegate,
        uint256 _delegatedVotePower,
        uint256 _rewardEpoch,
        uint256 _votePowerBlock
    ) internal view returns (uint256)
    {
        if (_delegatedVotePower == 0) {
            return 0;
        }

        uint256 totalReward = totalRewardsPerRewardEpoch[_rewardEpoch][_delegate];
        if (totalReward == 0) {
            return 0;
        }

        uint256 reward = 0;

        // reward earned by vote power share
        uint256 feePercentageBIPS = _getDataProviderFeePercentage(_delegate, _rewardEpoch);
        if (feePercentageBIPS < MAX_BIPS) {            
            uint256 votePower = wFlr.votePowerOfAt(_delegate, _votePowerBlock);
            reward += totalReward.mulDiv(
                _delegatedVotePower.mul(MAX_BIPS - feePercentageBIPS),
                votePower.mul(MAX_BIPS)
            );
        }

        return reward;
    }

    /**
     * @notice Returns fee percentage setting for `_dataProvider` at `_rewardEpoch`.
     * @param _dataProvider         address representing a data provider
     * @param _rewardEpoch          reward epoch number
     */
    function _getDataProviderFeePercentage(
        address _dataProvider,
        uint256 _rewardEpoch
    ) internal view returns (uint256)
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
            .sub(totalClaimedWei);
    }
}
