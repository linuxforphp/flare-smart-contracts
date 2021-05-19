// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../lib/SafePct.sol";
import "../interfaces/IFtsoManager.sol";
import "../interfaces/IRewardManager.sol";
import "./Governed.sol";
import "./WFLR.sol";

// import "hardhat/console.sol";

/**
 * RewardManager is in charge of:
 * - distributing rewards according to instructions from FTSO Manager
 * - allowing claims for rewards
 */    
contract RewardManager is IRewardManager, Governed {

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

    string internal constant ERR_INFLATION_ZERO = "no inflation";     
    string internal constant ERR_FTSO_MANAGER_ONLY = "ftso manager only";    
    string internal constant ERR_INFLATION_ONLY = "inflation only";    
    string internal constant ERR_FTSO_MANAGER_ZERO = "no ftso manager";
    string internal constant ERR_REWARD_NOT_EXPIRED = "reward not expired";
    string internal constant ERR_REWARD_MANAGER_DEACTIVATED = "reward manager deactivated";
    string internal constant ERR_FEE_PERCENTAGE_INVALID = "invalid fee percentage value";
    string internal constant ERR_FEE_PERCENTAGE_UPDATE_FAILED = "fee percentage can not be updated";

    // TODO: Note that there are leap seconds (last one was Dec 31, 2016).
    // NOTE: They are not deterministic. IERS notifies the public in advance.
    // In order to be technically correct, the governance contract would need to
    // have a way to flip SECONDS_PER_DAY from 86400 to 86401 at the next June 30
    // or Dec 31 (the only two days in a year when a leap second can be added).
    // This assumes that the underlying operating system follows IERS recommendation,
    // which Unix does not. Instead, it slows the clock down. Is this OS universal? Dunno.
    uint32 constant private SECONDS_PER_DAY = 86400;

    uint256 constant internal SHARING_PERCENTAGE_EPOCH_OFFSET = 2;
    uint256 constant internal MAX_BIPS = 1e4;

    bool internal active;

    uint256 internal feePercentageUpdateOffset; // timelock for fee percentage update measured in reward epochs
    uint256 public defaultFeePercentage; // default value for fee percentage
    
    uint256 public rewardExpiryOffset = 100; // period of reward expiry (in reward epochs)

    /**
     * @dev Provides a mapping of reward epoch ids to an address mapping of unclaimed
     *  rewards.
     */
    mapping(uint256 => mapping(address => uint256)) public unclaimedRewardsPerRewardEpoch;
    mapping(uint256 => mapping(address => uint256)) public totalRewardsPerRewardEpoch;
    mapping(uint256 => mapping(address => mapping(address => bool))) public rewardClaimed;
    mapping(address => FeePercentage[]) public dataProviderFeePercentages;
    uint256 public dailyRewardAmountTwei;
    uint256 public distributedSoFarTwei;

    /// addresses
    address public inflationContract;
    IFtsoManager public ftsoManagerContract;
    WFLR public wFlr; 

    // flags
    bool private justStarted;

    constructor(
        address _governance,
        address _inflation
    ) Governed(_governance) 
    {
        require(_inflation != address(0), ERR_INFLATION_ZERO);
        
        inflationContract = _inflation;
        justStarted = true;
    }

    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    modifier onlyFtsoManager () {
        require (msg.sender == address(ftsoManagerContract), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    modifier onlyInflation () {
        require (msg.sender == inflationContract, ERR_INFLATION_ONLY);
        _;
    }

    modifier ftsoManagerSet () {
        require (address(ftsoManagerContract) != address(0), ERR_FTSO_MANAGER_ZERO);
        _;
    }

    modifier onlyIfActive() {
        require(active, ERR_REWARD_MANAGER_DEACTIVATED);
        _;
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
    ) external view returns (
        address[] memory _dataProviders,
        uint256[] memory _rewardAmounts,
        bool[] memory _claimed,
        bool _claimable
    ) {
        RewardState memory rewardState = _getStateOfRewards(_beneficiary, _rewardEpoch, false);
        _dataProviders = rewardState.dataProviders;
        _rewardAmounts = rewardState.rewardAmounts;
        _claimed = rewardState.claimed;
        _claimable = _isRewardClaimable(_rewardEpoch, ftsoManagerContract.getCurrentRewardEpoch());
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
    ) external view returns (
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
        _claimable = _isRewardClaimable(_rewardEpoch, ftsoManagerContract.getCurrentRewardEpoch());
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
    ) external override onlyIfActive returns (
        uint256 _rewardAmount
    ) {
        uint256 currentRewardEpoch = ftsoManagerContract.getCurrentRewardEpoch();
                
        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState = _getStateOfRewards(msg.sender, _rewardEpochs[i], true);
            _rewardAmount += _claimReward(_recipient, _rewardEpochs[i], rewardState);
        }

        if (_rewardAmount > 0) {
            // transfer total amount (state is updated and events are emitted in _claimReward)
            _recipient.transfer(_rewardAmount);
        }
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
    ) external onlyIfActive returns (
        uint256 _rewardAmount
    ) {
        uint256 currentRewardEpoch = ftsoManagerContract.getCurrentRewardEpoch();

        for (uint256 i = 0; i < _rewardEpochs.length; i++) {
            if (!_isRewardClaimable(_rewardEpochs[i], currentRewardEpoch)) {
                continue;
            }
            RewardState memory rewardState;
            rewardState = _getStateOfRewardsFromDataProviders(msg.sender, _rewardEpochs[i], _dataProviders, true);
            _rewardAmount += _claimReward(_recipient, _rewardEpochs[i], rewardState);
        }

        if (_rewardAmount > 0) {
            // transfer total amount (state is updated and events are emitted in _claimReward)
            _recipient.transfer(_rewardAmount);
        }
    }

    // TODO: consider who has authority to use this function
    // TODO: possibly emit an event
    /**
     * @notice Transfers rewards that are no longer claimable to `_recipient`.
     * @param _recipient            address to transfer funds to
     * @param _rewardEpoch          reward epoch number
     * @param _dataProviders        array of addresses representing data providers
     * @return Returns the total transferred amount.
     */
    function transferUnclaimedRewardForDataProviders(
        address payable _recipient,
        uint256 _rewardEpoch,
        address[] memory _dataProviders
    ) external onlyGovernance returns (uint256)
    {
        uint256 currentRewardEpoch = ftsoManagerContract.getCurrentRewardEpoch();
        require(!_isRewardClaimable(_rewardEpoch, currentRewardEpoch), ERR_REWARD_NOT_EXPIRED);

        uint256 amount = 0;
        for (uint256 i = 0; i < _dataProviders.length; i++) {
            amount += unclaimedRewardsPerRewardEpoch[_rewardEpoch][_dataProviders[i]];
            unclaimedRewardsPerRewardEpoch[_rewardEpoch][_dataProviders[i]] = 0;
        }

        if (amount > 0) {            
            _recipient.transfer(amount);
        }

        return amount;
    }

    /**
     * @notice Activates reward manager (allows claiming rewards)
     */
    function activate() external onlyGovernance {
        active = true;
    }

    /**
     * @notice Deactivates reward manager (prevents claiming rewards)
     */
    function deactivate() external onlyGovernance {
        active = false;
    }

    function setDailyRewardAmount(uint256 rewardAmountTwei) external override onlyInflation {
        // TODO: Accounting of FLR in contract vs. this number needs to be reconciled
        dailyRewardAmountTwei = rewardAmountTwei;
        // TODO: add event
    }
   
    /**
     * @notice sets FTSO manager corresponding to the reward manager
     */
    function setFTSOManager(IFtsoManager _ftsoManager) external override onlyGovernance {
        ftsoManagerContract = _ftsoManager;
    }

    /**
     * @notice Sets WFLR token.
     */
    function setWFLR(WFLR _wFlr) external override onlyGovernance {
        wFlr = _wFlr;
    }

    /**
     * @notice Distributes rewards to data providers accounts, according to input parameters.
     */
    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochDurationSec,
        uint256 currentRewardEpoch
    ) external override ftsoManagerSet onlyFtsoManager returns (bool) {

        // TODO: Due to remainders in division the sum of distributions for whole day will not 
        // sum up into dailyRewardAmountTwei. 
        // (dailyRewardAmountTwei * priceEpochDurationSec) % SECONDS_PER_DAY 
        // will remain undistributed
        uint256 totalPriceEpochRewardTwei = dailyRewardAmountTwei * priceEpochDurationSec / SECONDS_PER_DAY;
        uint256 distributedSoFar = 0;
        

        if (addresses.length == 0) return false;        
        // TODO: we should assure that in case we are here, totalWeight > 0. Please verify.

        uint256[] memory rewards = new uint256[](addresses.length);

        for (uint i = addresses.length - 1; i > 0; i--) {
            uint256 rewardAmount = totalPriceEpochRewardTwei * weights[i] / totalWeight;
            distributedSoFar += rewardAmount;
            rewards[i] = rewardAmount;
            unclaimedRewardsPerRewardEpoch[currentRewardEpoch][addresses[i]] +=
                rewardAmount;
            totalRewardsPerRewardEpoch[currentRewardEpoch][addresses[i]] +=
                rewardAmount;
        }

        // give remaining amount to last address.
        unclaimedRewardsPerRewardEpoch[currentRewardEpoch][addresses[0]] += 
            totalPriceEpochRewardTwei - distributedSoFar;
        totalRewardsPerRewardEpoch[currentRewardEpoch][addresses[0]] +=
            totalPriceEpochRewardTwei - distributedSoFar;

        emit RewardDistributedByFtso(ftso, epochId, addresses, rewards);
        return true; 
    }

    /**
     * @notice Allows data provider to set (or update last) fee percentage.
     * @param _feePercentageBIPS    number representing fee percentage in BIPS
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function setDataProviderFeePercentage(uint256 _feePercentageBIPS) external override returns (uint256) {
        require(_feePercentageBIPS <= MAX_BIPS, ERR_FEE_PERCENTAGE_INVALID);
        
        uint256 rewardEpoch = ftsoManagerContract.getCurrentRewardEpoch() + feePercentageUpdateOffset;
        
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
     * @notice Returns the current fee percentage of `_dataProvider`
     * @param _dataProvider         address representing data provider
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider) external view override returns (uint256) {
        return _getDataProviderFeePercentage(_dataProvider, ftsoManagerContract.getCurrentRewardEpoch());
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
            uint256 currentEpoch = ftsoManagerContract.getCurrentRewardEpoch();
            uint256 position = fps.length;
            while (fps[position - 1].validFromEpoch > currentEpoch) {
                position--;
            }
            uint256 count = fps.length - position;
            if (count > 0) {
                _feePercentageBIPS = new uint256[](count);
                _validFromEpoch = new uint256[](count);
                _fixed = new bool[](count);
                for (uint256 i = position; i < fps.length; i++) {
                    _feePercentageBIPS[i] = fps[i].value;
                    _validFromEpoch[i] = fps[i].validFromEpoch;
                    _fixed[i] = (_validFromEpoch[i] - currentEpoch) == feePercentageUpdateOffset;
                }
            }
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
                distributedSoFarTwei += rewardAmount;
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
        uint256 votePowerBlock = ftsoManagerContract.getRewardEpochVotePowerBlock(_rewardEpoch);

        bool dataProviderClaimed = _isRewardClaimed(_rewardEpoch, _beneficiary, _beneficiary);
        uint256 dataProviderAmount = _getRewardAmountForDataProvider(_beneficiary, _rewardEpoch, votePowerBlock);
        uint256 dataProviderReward = (dataProviderClaimed || dataProviderAmount > 0) ? 1 : 0;

        address[] memory delegates;
        uint256[] memory bips;
        (delegates, bips, , ) = wFlr.delegatesOfAt(msg.sender, votePowerBlock);
        
        _rewardState.dataProviders = new address[](dataProviderReward + delegates.length);
        _rewardState.rewardAmounts = new uint256[](dataProviderReward + delegates.length);
        _rewardState.claimed = new bool[](dataProviderReward + delegates.length);

        if (dataProviderReward == 1) {
            _rewardState.dataProviders[0] = _beneficiary;
            _rewardState.claimed[0] = dataProviderClaimed;
            _rewardState.rewardAmounts[0] = (_zeroForClaimed && dataProviderClaimed) ? 0 : dataProviderAmount;
        }

        if (delegates.length > 0) {
            uint256 delegatorBalance = wFlr.balanceOfAt(msg.sender, votePowerBlock);
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
        uint256 votePowerBlock = ftsoManagerContract.getRewardEpochVotePowerBlock(_rewardEpoch);

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

        uint256 reward = 0;

        // data provider fee
        uint256 feePercentageBIPS = _getDataProviderFeePercentage(_dataProvider, _rewardEpoch);
        if (feePercentageBIPS > 0) {
            reward += totalReward.mulDiv(feePercentageBIPS, MAX_BIPS);
        }

        // reward earned by vote power share
        if (feePercentageBIPS < MAX_BIPS && dataProviderVotePower > 0) {
            reward += totalReward.mulDiv(
                    (MAX_BIPS - feePercentageBIPS).mul(dataProviderVotePower),
                    MAX_BIPS.mul(votePower)
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
                (MAX_BIPS - feePercentageBIPS).mul(_delegatedVotePower),
                MAX_BIPS.mul(votePower)
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

}
