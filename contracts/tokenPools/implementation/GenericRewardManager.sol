// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIGenericRewardManager.sol";
import "../../utils/implementation/AddressSet.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../governance/implementation/Governed.sol";
import "../../token/implementation/WNat.sol";
import "../../utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * GenericRewardManager is in charge of:
 * - distributing rewards according to instructions from reward distributor
 * - allowing claims for rewards
 */    

//solhint-disable-next-line max-states-count
abstract contract GenericRewardManager is IIGenericRewardManager, Governed, ReentrancyGuard, AddressUpdatable {
    using SafePct for uint256;
    using SafeMath for uint256;
    using AddressSet for AddressSet.State;

    string internal constant ERR_REWARD_DISTRIBUTOR_ONLY = "reward distributor only";
    string internal constant ERR_INFLATION_ONLY = "inflation only";
    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_CLAIM_FAILED = "claim failed";
    string internal constant ERR_REWARD_MANAGER_DEACTIVATED = "reward manager deactivated";
    string internal constant ERR_EXECUTOR_ONLY = "claim executor only";
    string internal constant ERR_RECIPIENT_NOT_ALLOWED = "recipient not allowed";
    string internal constant ERR_TOO_MUCH = "too much";
    string internal constant ERR_ARRAY_MISMATCH = "arrays lengths mismatch";
    
    bool public override active;

    mapping(address => uint256) internal beneficiaryRewardAmount;
    mapping(address => uint256) internal beneficiaryClaimedRewardAmount;

    // mapping reward owner address => executor set
    mapping(address => AddressSet.State) internal claimExecutorSet;
    
    // mapping reward owner address => claim recipient address
    mapping(address => AddressSet.State) internal allowedClaimRecipientSet;

    // Totals
    uint256 internal totalAwardedWei;     // rewards that were distributed
    uint256 internal totalClaimedWei;     // rewards that were claimed
    uint256 internal totalInflationAuthorizedWei;
    uint256 internal totalInflationReceivedWei;
    uint256 internal totalSelfDestructReceivedWei;
    uint256 internal lastInflationAuthorizationReceivedTs;
    uint256 internal dailyAuthorizedInflation;

    uint256 internal lastBalance;

    /// addresses
    address public rewardDistributor;
    address internal inflation;
    WNat public wNat;

    // for redeploy
    address public immutable oldRewardManager;
    address public newRewardManager;

    modifier mustBalance {
        _;
        _checkMustBalance();
    }
    
    modifier onlyRewardDistributor() {
        _checkOnlyRewardDistributor();
        _;
    }

    modifier onlyIfActive() {
        _checkOnlyActive();
        _;
    }

    modifier onlyInflation {
        require(msg.sender == inflation, ERR_INFLATION_ONLY);
        _;
    }

    modifier onlyRewardExecutorAndAllowedRecipient(address _rewardOwner, address _recipient) {
        _checkExecutorAndAllowedRecipient(_rewardOwner, _recipient);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        address _oldRewardManager
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {
        oldRewardManager = _oldRewardManager;
    }

    /**
     * @notice Allows a beneficiary to claim rewards.
     * @notice This function is intended to be used to claim rewards.
     * @param _recipient            address to transfer funds to
     * @param _rewardAmount         amount of rewards to claim
     */
    function claimReward(
        address payable _recipient,
        uint256 _rewardAmount
    ) 
        external override
        onlyIfActive
        mustBalance
        nonReentrant 
    {
        _claimOrWrapReward(msg.sender, _recipient, _rewardAmount, false);
    }

    /**
     * @notice Allows a beneficiary to claim and wrap rewards.
     * @notice This function is intended to be used to claim and wrap rewards.
     * @param _recipient            address to transfer funds to
     * @param _rewardAmount         amount of rewards to claim and wrap
     */
    function claimAndWrapReward(
        address payable _recipient,
        uint256 _rewardAmount
    ) 
        external override
        onlyIfActive
        mustBalance
        nonReentrant 
    {
        _claimOrWrapReward(msg.sender, _recipient, _rewardAmount, true);
    }

    /**
     * @notice Allows a beneficiary to claim and wrap rewards.
     * @notice This function is intended to be used to claim and wrap rewards.
     * @notice The caller does not have to be the owner, but must be approved by the owner to claim on his behalf.
     *   this approval is done by calling `addClaimExecutor`.
     * @notice It is actually safe for this to be called by anybody (nothing can be stolen), but by limiting who can
     *   call, we allow the owner to control the timing of the calls.
     * @param _rewardOwner          address of the reward owner
     * @param _rewardAmount         amount of rewards to claim and wrap
     */
    function claimAndWrapRewardByExecutor(
        address _rewardOwner,
        address payable _recipient,
        uint256 _rewardAmount
    ) 
        external override
        onlyIfActive
        mustBalance
        nonReentrant
        onlyRewardExecutorAndAllowedRecipient(_rewardOwner, _recipient)
    {
        _claimOrWrapReward(_rewardOwner, _recipient, _rewardAmount, true);
    }

    /**
     * Set the addresses of executors, who are allowed to call claimAndWrapRewardByExecutor.
     * @param _executors The new executors. All old executors will be deleted and replaced by these.
     */    
    function setClaimExecutors(address[] memory _executors) external override {
        claimExecutorSet[msg.sender].replaceAll(_executors);
        emit ClaimExecutorsChanged(msg.sender, _executors);
    }
    
    /**
     * Set the addresses of allowed recipients in the method claimAndWrapRewardByExecutor.
     * Apart from these, the reward owner is always an allowed recipient.
     * @param _recipients The new allowed recipients. All old recipients will be deleted and replaced by these.
     */    
    function setAllowedClaimRecipients(address[] memory _recipients) external override {
        allowedClaimRecipientSet[msg.sender].replaceAll(_recipients);
        emit AllowedClaimRecipientsChanged(msg.sender, _recipients);
    }

    /**
     * @notice Activates reward manager (allows claiming rewards)
     */
    function activate() external override onlyImmediateGovernance {
        require(inflation != address(0) && address(rewardDistributor) != address(0) && address(wNat) != address(0),
            "contract addresses not set");
        active = true;
    }

    /**
     * @notice Deactivates reward manager (prevents claiming rewards)
     */
    function deactivate() external override onlyImmediateGovernance {
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

        emit InflationReceived(msg.value);
    }

    /**
     * @notice Distributes rewards to beneficiary accounts, according to input parameters.
     * @dev must be called with _addresses.length == _rewardAmounts.length
     */
    function distributeRewards(
        address[] memory _addresses,
        uint256[] memory _rewardAmounts
    )
        external override
        onlyRewardDistributor
    {
        uint256 len = _addresses.length;
        require(len == _rewardAmounts.length, ERR_ARRAY_MISMATCH);

        for(uint256 i = 0; i < len; i++) {
            beneficiaryRewardAmount[_addresses[i]] += _rewardAmounts[i];
            totalAwardedWei += _rewardAmounts[i];
        }

        require(totalAwardedWei <= totalInflationAuthorizedWei, ERR_TOO_MUCH);

        emit RewardsDistributed(_addresses, _rewardAmounts);
    }

    /**
     * @notice Sets new reward manager
     * @dev Should be called at the time of switching to the new reward manager, can be called only once
     */
    function setNewRewardManager(address _newRewardManager) external onlyGovernance {
        require(newRewardManager == address(0), "new reward manager already set");
        newRewardManager = _newRewardManager;
    }

    /**
     * @notice Sets new reward distributor which will take over distribution of rewards
     */
    function setRewardDistributor(address _rewardDistributor) external onlyGovernance {
        rewardDistributor = _rewardDistributor;
    }

    /**
     * @notice Returns information of beneficiary rewards
     * @param _beneficiary          beneficiary address
     * @return _totalReward         number representing the total reward
     * @return _claimedReward       number representing the amount of total reward that has been claimed
     */
    function getStateOfRewards(
        address _beneficiary
    )
        external view override 
        returns (uint256 _totalReward, uint256 _claimedReward) 
    {
        _totalReward = beneficiaryRewardAmount[_beneficiary];
        _claimedReward = beneficiaryClaimedRewardAmount[_beneficiary];
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
        return (0, totalInflationAuthorizedWei, totalClaimedWei);
    }

    function getTotals() 
        external view override
        returns (
            uint256 _totalAwardedWei,
            uint256 _totalClaimedWei,
            uint256 _totalInflationAuthorizedWei,
            uint256 _totalInflationReceivedWei,
            uint256 _totalSelfDestructReceivedWei,
            uint256 _lastInflationAuthorizationReceivedTs,
            uint256 _dailyAuthorizedInflation
        )
    {
        return (
            totalAwardedWei,
            totalClaimedWei,
            totalInflationAuthorizedWei,
            totalInflationReceivedWei,
            totalSelfDestructReceivedWei,
            lastInflationAuthorizationReceivedTs,
            dailyAuthorizedInflation
        );
    }
    
    /**
     * Get the addresses of executors, who are allowed to call claimAndWrapRewardByExecutor.
     */    
    function claimExecutors(address _rewardOwner) external view override returns (address[] memory) {
        return claimExecutorSet[_rewardOwner].list;
    }

    /**
     * Get the addresses of allowed recipients in the method claimAndWrapRewardByExecutor.
     * Apart from these, the reward owner is always an allowed recipient.
     */    
    function allowedClaimRecipients(address _rewardOwner) external view override returns (address[] memory) {
        return allowedClaimRecipientSet[_rewardOwner].list;
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
     * @notice Allows a beneficiary to claim rewards.
     * @notice This function is intended to be used to claim or wrap rewards.
     * @param _recipient            address to transfer funds to
     * @param _rewardAmount         amount of rewards to claim or wrap
     * @param _wrap                 indicates if reward should be wrapped
     */
    function _claimOrWrapReward(
        address _rewardOwner,
        address payable _recipient,
        uint256 _rewardAmount,
        bool _wrap
    ) 
        internal
    {
        _handleSelfDestructProceeds();

        beneficiaryClaimedRewardAmount[_rewardOwner] += _rewardAmount;
        require(beneficiaryClaimedRewardAmount[_rewardOwner] <= beneficiaryRewardAmount[_rewardOwner], ERR_TOO_MUCH);
        totalClaimedWei += _rewardAmount;

        if (_wrap) {
            _sendWrappedRewardTo(_recipient, _rewardAmount);
        } else {
            _transferReward(_recipient, _rewardAmount);
        }

        emit RewardClaimed({
            beneficiary: _rewardOwner,
            sentTo: _recipient,
            amount: _rewardAmount
        });

        //slither-disable-next-line reentrancy-eth          // guarded by nonReentrant
        lastBalance = address(this).balance;
    }

    /**
     * @notice Transfers `_rewardAmount` to `_recipient`.
     * @param _recipient            address representing the reward recipient
     * @param _rewardAmount         number representing the amount to transfer
     * @dev Uses low level call to transfer funds.
     */
    function _transferReward(address payable _recipient, uint256 _rewardAmount) internal {
        if (_rewardAmount > 0) {
            // transfer total amount (state is updated and events are emitted in _claimOrWrapReward)
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send          // amount always checked in _claimOrWrapReward
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
            // transfer total amount (state is updated and events are emitted in _claimOrWrapReward)
            //slither-disable-next-line arbitrary-send          // amount always checked in _claimOrWrapReward
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
        wNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
    }

    function _getExpectedBalance() internal view returns(uint256 _balanceExpectedWei) {
        return totalInflationReceivedWei
            .add(totalSelfDestructReceivedWei)
            .sub(totalClaimedWei);
    }

    function _checkExecutorAndAllowedRecipient(address _rewardOwner, address _recipient) internal view {
        require(claimExecutorSet[_rewardOwner].index[msg.sender] != 0, 
            ERR_EXECUTOR_ONLY);
        require(_recipient == _rewardOwner || allowedClaimRecipientSet[_rewardOwner].index[_recipient] != 0,
            ERR_RECIPIENT_NOT_ALLOWED);
    }
    
    function _checkMustBalance() internal view {
        require(address(this).balance == _getExpectedBalance(), ERR_OUT_OF_BALANCE);
    }

    function _checkOnlyRewardDistributor() internal view {
        require (msg.sender == address(rewardDistributor), ERR_REWARD_DISTRIBUTOR_ONLY);
    }

    function _checkOnlyActive() internal view {
        require(active, ERR_REWARD_MANAGER_DEACTIVATED);
    }
}
