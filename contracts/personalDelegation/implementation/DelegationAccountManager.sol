// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./CloneFactory.sol";
import "../interface/IIDelegationAccountManager.sol";
import "../interface/IIDelegationAccount.sol";
import "../../userInterfaces/IDistributionToDelegators.sol";
import "../../userInterfaces/IFtsoManager.sol";
import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../utils/implementation/AddressSet.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract DelegationAccountManager is IIDelegationAccountManager, 
    Governed, AddressUpdatable, CloneFactory, ReentrancyGuard
{
    using AddressSet for AddressSet.State;

    struct ExecutorFee {            // used for storing executor fee settings
        uint256 value;              // fee value (value between 0 and `maxFeeValueWei`)
        uint256 validFromEpoch;     // id of the reward epoch from which the value is valid
    }

    struct DelegationAccountData {              // used for storing data about delegation account
        IIDelegationAccount delegationAccount;  // delegation account address
        bool enabled;                           // indicates if delegation account is enabled
    }

    string internal constant ERR_EXECUTOR_FEE_INVALID = "invalid executor fee value";
    string internal constant ERR_TRANSFER_FAILURE = "transfer failed";
    string internal constant ERR_FEE_INVALID = "invalid fee value";
    string internal constant ERR_VALUE_ZERO = "value zero";
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_NOT_REGISTERED = "not registered";
    string internal constant ERR_NOT_FOUND = "not found";
    string internal constant ERR_ALREADY_REGISTERED = "already registered";
    string internal constant ERR_REWARD_EPOCH_INVALID = "invalid reward epoch";
    string internal constant ERR_FEE_UPDATE_FAILED = "fee can not be updated";
    string internal constant ERR_NO_DELEGATION_ACCOUNT = "no delegation account";
    string internal constant ERR_LIBRARY_ADDRESS_NOT_SET_YET = "library address not set yet";
    string internal constant ERR_CREATE_CLONE = "clone not successfully created";
    
    address payable constant internal BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 public immutable feeValueUpdateOffset;      // fee value update timelock measured in reward epochs
    uint256 public maxFeeValueWei;                      // max value for fee
    uint256 public registerExecutorFeeValueWei;         // fee value that executor must pay to register

    IFtsoManager public ftsoManager;
    WNat public override wNat;
    IGovernanceVotePower public governanceVP;
    IFtsoRewardManager[] internal ftsoRewardManagers;
    IDistributionToDelegators public distribution;

    address public libraryAddress;

    // mapping owner address => delegation account address
    mapping(address => DelegationAccountData) private ownerToDelegationAccountData;

    // mapping owner address => executor set
    mapping(address => AddressSet.State) private ownerClaimExecutorSet;

    // mapping executor address => executor fees
    mapping(address => ExecutorFee[]) private claimExecutorFees;

    AddressSet.State private registeredExecutors;

    modifier onlyOwnerOrExecutor(address[] memory _owners) {
        _checkOnlyOwnerOrExecutor(_owners);
        _;
    }

    constructor(
        address _governance,
        address _addressUpdater,
        uint256 _feeValueUpdateOffset,
        uint256 _maxFeeValueWei,
        uint256 _registerExecutorFeeValueWei
    ) 
        Governed(_governance)
        AddressUpdatable(_addressUpdater)
    {
        require(_feeValueUpdateOffset > 0, ERR_VALUE_ZERO);
        require(_maxFeeValueWei > 0, ERR_VALUE_ZERO);
        require(_registerExecutorFeeValueWei > 0, ERR_VALUE_ZERO);
        feeValueUpdateOffset = _feeValueUpdateOffset;
        maxFeeValueWei = _maxFeeValueWei;
        emit MaxFeeSet(_maxFeeValueWei); 
        registerExecutorFeeValueWei = _registerExecutorFeeValueWei;
        emit RegisterExecutorFeeSet(_registerExecutorFeeValueWei);
    }

    /**
     * @notice Sets the addresses of executors and creates delegation account contract if it does not exist.
     * @notice If setting registered executors some fee must be paid to them.
     * @param _executors        The new executors. All old executors will be deleted and replaced by these.
     * @return Address of delegation account contract.
     */
    function setClaimExecutors(address[] memory _executors)
        external payable override nonReentrant 
        returns (IDelegationAccount)
    {
        // creates delegation account if it does not exist
        DelegationAccountData storage delegationAccountData = _getOrCreateDelegationAccountData();
        // replace executors
        ownerClaimExecutorSet[msg.sender].replaceAll(_executors);
        emit ClaimExecutorsChanged(msg.sender, _executors);
        uint256 totalExecutorsFee = 0;
        for (uint256 i = 0 ; i < _executors.length; i++) {
            uint256 executorFee = getExecutorCurrentFeeValue(_executors[i]);
            if (executorFee > 0) {
                totalExecutorsFee += executorFee;
                //slither-disable-next-line arbitrary-send-eth
                wNat.depositTo{value: executorFee}(_executors[i]);
            }
        }
        require (totalExecutorsFee <= msg.value, ERR_EXECUTOR_FEE_INVALID);
        if (msg.value > totalExecutorsFee) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = msg.sender.call{value: msg.value - totalExecutorsFee}(""); //nonReentrant
            /* solhint-enable avoid-low-level-calls */
            require(success, ERR_TRANSFER_FAILURE);
            emit SetExecutorsExcessAmountRefunded(msg.sender, msg.value - totalExecutorsFee);
        }
        return delegationAccountData.delegationAccount;
    }

    /**
     * @notice Enables (creates) delegation account contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will remain on delegation account and 
     * will not be automatically transferred to owner's account.
     * @return Address of delegation account contract.
     */
    function enableDelegationAccount() external override returns (IDelegationAccount) {
        DelegationAccountData storage delegationAccountData = _getOrCreateDelegationAccountData();
        IIDelegationAccount delegationAccount = delegationAccountData.delegationAccount;
        delegationAccount.enableClaimingToDelegationAccount();
        delegationAccountData.enabled = true;
        emit DelegationAccountUpdated(msg.sender, delegationAccount, true);
        return delegationAccount;
    }

    /**
     * @notice Disables delegation account contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will not remain on delegation account but 
     * will be automatically transferred to owner's account.
     * @notice Automatic claiming will not claim ftso rewards and airdrop for delegation account anymore.
     * @dev Reverts if there is no delegation account
     */
    function disableDelegationAccount() external override {
        DelegationAccountData storage delegationAccountData = ownerToDelegationAccountData[msg.sender];
        IIDelegationAccount delegationAccount = delegationAccountData.delegationAccount;
        require(address(delegationAccount) != address(0), ERR_NO_DELEGATION_ACCOUNT);
        delegationAccount.disableClaimingToDelegationAccount(wNat);
        delegationAccountData.enabled = false;
        emit DelegationAccountUpdated(msg.sender, delegationAccount, false);
    }

    /**
     * @notice Claim ftso rewards for delegation account
     * @notice Fee is not paid to executor
     * @param _owners       list of owner addresses
     * @param _epochs       list of epochs to claim for
     * @return              Array of claimed amounts
     */
    function claimDelegationAccountFtsoRewards(
        address[] memory _owners,
        uint256[] memory _epochs
    )
        external override onlyOwnerOrExecutor(_owners)
        returns(uint256[] memory)
    {
        return _claimFtsoRewards(_owners, _epochs, true, false);
    }

    /**
     * @notice Claim ftso rewards for owner
     * @notice Fee is not paid to executor
     * @param _owners       list of owner addresses
     * @param _epochs       list of epochs to claim for
     * @return              Array of claimed amounts
     */
    function claimOwnerFtsoRewards(
        address[] memory _owners,
        uint256[] memory _epochs
    )
        external override onlyOwnerOrExecutor(_owners)
        returns(uint256[] memory)
    {
        return _claimFtsoRewards(_owners, _epochs, false, true);
    }

    /**
     * @notice Claim ftso rewards for delegation account and owner
     * @notice If called by executor a fee is transferred to executor or tx is reverted (claimed amount too small)
     * @param _owners       list of owner addresses
     * @param _epochs       list of epochs to claim for
     * @return              Array of claimed amounts
     */
    function claimFtsoRewards(
        address[] memory _owners,
        uint256[] memory _epochs
    )
        external override onlyOwnerOrExecutor(_owners)
        returns(uint256[] memory)
    {
        return _claimFtsoRewards(_owners, _epochs, true, true);
    }

    /**
     * @notice Claim airdrop distribution for delegation account
     * @notice Fee is not paid to executor
     * @param _owners       list of owner addresses
     * @param _month        month to claim for
     * @return              Array of claimed amounts
     */
    function claimDelegationAccountAirdropDistribution(
        address[] memory _owners,
        uint256 _month
    )
        external override onlyOwnerOrExecutor(_owners)
        returns(uint256[] memory)
    {
        return _claimAirdropDistribution(_owners, _month, true, false);
    }

    /**
     * @notice Claim airdrop distribution for owner
     * @notice Fee is not paid to executor
     * @param _owners       list of owner addresses
     * @param _month        month to claim for
     * @return              Array of claimed amounts
     */
    function claimOwnerAirdropDistribution(
        address[] memory _owners,
        uint256 _month
    )
        external override onlyOwnerOrExecutor(_owners)
        returns(uint256[] memory)
    {
        return _claimAirdropDistribution(_owners, _month, false, true);
    }

    /**
     * @notice Claim airdrop distribution for delegation account and owner
     * @notice If called by executor a fee is transferred to executor or tx is reverted (claimed amount too small)
     * @param _owners       list of owner addresses
     * @param _month        month to claim for
     * @return              Array of claimed amounts
     */
    function claimAirdropDistribution(
        address[] memory _owners,
        uint256 _month
    )
        external override onlyOwnerOrExecutor(_owners)
        returns(uint256[] memory)
    {
        return _claimAirdropDistribution(_owners, _month, true, true);
    }

    /**
     * @notice Allows executor to register and set initial fee value from current reward epoch on.
     * If executor was already registered before (has fee set), only update fee value after `feeValueUpdateOffset`.
     * @notice Executor must pay fee in order to register - `registerExecutorFeeValueWei`.
     * @param _feeValue    number representing fee value - zero value is allowed
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function registerExecutor(uint256 _feeValue) external payable override returns (uint256) {
        require(registeredExecutors.index[msg.sender] == 0, ERR_ALREADY_REGISTERED);
        require(registerExecutorFeeValueWei == msg.value, ERR_EXECUTOR_FEE_INVALID);
        //slither-disable-next-line arbitrary-send-eth
        BURN_ADDRESS.transfer(msg.value);
        // add and emit event
        registeredExecutors.add(msg.sender);
        emit ExecutorRegistered(msg.sender);
        // check last executor fee change
        uint256 currentRewardEpoch = ftsoManager.getCurrentRewardEpoch();
        ExecutorFee[] storage efs = claimExecutorFees[msg.sender];
        if (efs.length == 0 || efs[efs.length - 1].validFromEpoch < currentRewardEpoch) {
            // if registering for the first time or after a while, sets the fee value from current epoch on
            require( _feeValue <= maxFeeValueWei, ERR_FEE_INVALID);
            efs.push(ExecutorFee({value: _feeValue, validFromEpoch: currentRewardEpoch}));
            emit ClaimExecutorFeeValueChanged(msg.sender, currentRewardEpoch, _feeValue);
            return currentRewardEpoch;
        } else {
            return _updateExecutorFeeValue(currentRewardEpoch, _feeValue);
        }
    }

    /**
     * @notice Allows executor to unregister.
     * @return _validFromEpoch Returns the reward epoch number when the setting becomes effective.
     */
    function unregisterExecutor() external override returns (uint256 _validFromEpoch) {
        require(registeredExecutors.index[msg.sender] != 0, ERR_NOT_REGISTERED);
        // remove from registered
        registeredExecutors.remove(msg.sender);
        // set fee to 0 (after `feeValueUpdateOffset` - to prevent immediate new registration)
        _validFromEpoch = _updateExecutorFeeValue(ftsoManager.getCurrentRewardEpoch(), 0);
        // emit event
        emit ExecutorUnregistered(msg.sender, _validFromEpoch);
    }

    /**
     * @notice Allows registered executor to set (or update last scheduled) fee value.
     * @param _feeValue     number representing fee value - zero value is allowed
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function updateExecutorFeeValue(
        uint256 _feeValue
    ) 
        external override
        returns (uint256)
    {
        require(registeredExecutors.index[msg.sender] != 0, ERR_NOT_REGISTERED);
        return _updateExecutorFeeValue(ftsoManager.getCurrentRewardEpoch(), _feeValue);
    }

    /**
     * @notice Delegate `_bips` of voting power to `_to` from msg.sender's delegation account
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     */
    function delegate(address _to, uint256 _bips) external override {
        _getDelegationAccount(msg.sender).delegate(wNat, _to, _bips);
    }

    /**
     * @notice Undelegate all percentage delegations from the msg.sender's delegation account and then delegate 
     *   corresponding `_bips` percentage of voting power to each member of `_delegatees`.
     * @param _delegatees The addresses of the new recipients.
     * @param _bips The percentages of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Total of all `_bips` values must be at most 10000.
     */
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external override {
        _getDelegationAccount(msg.sender).batchDelegate(wNat, _delegatees, _bips);
    }

    /**
     * @notice Undelegate all voting power for delegates of msg.sender's delegation account
     */
    function undelegateAll() external override {
        _getDelegationAccount(msg.sender).undelegateAll(wNat);
    }

    /**
     * @notice Revoke all delegation from msg.sender's delegation account to `_who` at given block. 
     *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
     *    Block `_blockNumber` must be in the past. 
     *    This method should be used only to prevent rogue delegate voting in the current voting block.
     *    To stop delegating use delegate with value of 0 or undelegateAll.
     */
    function revokeDelegationAt(address _who, uint256 _blockNumber) external override {
        _getDelegationAccount(msg.sender).revokeDelegationAt(wNat, _who, _blockNumber);
    }

    /**
     * @notice Delegate all governance vote power of msg.sender's delegation account to `_to`.
     * @param _to The address of the recipient
     */
    function delegateGovernance(address _to) external override {
        _getDelegationAccount(msg.sender).delegateGovernance(governanceVP, _to);
    }

    /**
     * @notice Undelegate governance vote power for delegate of msg.sender's delegation account
     */
    function undelegateGovernance() external override {
        _getDelegationAccount(msg.sender).undelegateGovernance(governanceVP);
    }

    /**
     * @notice Allows user to transfer WNat to owner's account.
     * @param _amount           Amount of tokens to transfer
     */
    function withdraw(uint256 _amount) external override {
        _getDelegationAccount(msg.sender).withdraw(wNat, _amount);
    }

    /**
     * @notice Allows user to transfer balance of ERC20 tokens owned by the personal delegation contract.
     The main use case is to transfer tokens/NFTs that were received as part of an airdrop or register 
     as participant in such airdrop.
     * @param _token            Target token contract address
     * @param _amount           Amount of tokens to transfer
     * @dev Reverts if target token is WNat contract - use method `withdraw` for that
     */
    function transferExternalToken(IERC20 _token, uint256 _amount) external override {
        _getDelegationAccount(msg.sender).transferExternalToken(wNat, _token, _amount);
    }
    
    /**
     * @notice Sets new max fee value which must be higher than 0.
     * @dev Only governance can call this.
     */
    function setMaxFeeValueWei(uint256 _maxFeeValueWei) external override onlyGovernance {
        require(_maxFeeValueWei > 0, ERR_VALUE_ZERO);
        maxFeeValueWei = _maxFeeValueWei;
        emit MaxFeeSet(_maxFeeValueWei);
    }

    /**
     * @notice Sets new register executor fee value which must be higher than 0.
     * @dev Only governance can call this.
     */
    function setRegisterExecutorFeeValueWei(uint256 _registerExecutorFeeValueWei) external override onlyGovernance {
        require(_registerExecutorFeeValueWei > 0, ERR_VALUE_ZERO);
        registerExecutorFeeValueWei = _registerExecutorFeeValueWei;
        emit RegisterExecutorFeeSet(_registerExecutorFeeValueWei);
    }

    /**
     * @notice Sets new library address.
     * @dev Only governance can call this.
     */
    function setLibraryAddress(address _libraryAddress) external override onlyGovernance {
        require(_libraryAddress != address(0), ERR_ADDRESS_ZERO);
        libraryAddress = _libraryAddress;
        emit SetLibraryAddress(libraryAddress);
    }

    /**
     * @notice Removes ftso reward manager `_ftsoRewardManager` from supported managers for claiming.
     * @dev Only governance can call this.
     */
    function removeFtsoRewardManager(IFtsoRewardManager _ftsoRewardManager) external override onlyGovernance {
        uint256 len = ftsoRewardManagers.length;

        for (uint256 i = 0; i < len; i++) {
            if (_ftsoRewardManager == ftsoRewardManagers[i]) {
                ftsoRewardManagers[i] = ftsoRewardManagers[len -1];
                ftsoRewardManagers.pop();
                emit FtsoRewardManagerRemoved(address(_ftsoRewardManager));
                return;
            }
        }

        revert(ERR_NOT_FOUND);
    }

    /**
     * @notice Gets the delegation account of the `_owner`. Returns address(0) if not created yet.
     */
    function accountToDelegationAccount(address _owner) external view override returns (address) {
        return address(_getDelegationAccount(_owner));
    }

    /**
     * @notice Gets the delegation account data for the `_owner`. Returns address(0) if not created yet.
     * @param _owner                        owner's address
     * @return _delegationAccount           owner's delegation account address - could be address(0)
     * @return _enabled                     indicates if delegation account is enabled
     */
    function getDelegationAccountData(
        address _owner
    )
        external view override
        returns (IDelegationAccount _delegationAccount, bool _enabled)
    {
        DelegationAccountData storage delegationAccountData = ownerToDelegationAccountData[_owner];
        _delegationAccount = delegationAccountData.delegationAccount;
        _enabled = delegationAccountData.enabled;
    }

    /**
     * @notice Returns info if `_executor` is allowed to execute calls for `_owner`
     */
    function isClaimExecutor(address _owner, address _executor) external view override returns(bool) {
        return ownerClaimExecutorSet[_owner].index[_executor] != 0;
    }

    /**
     * @notice Get registered executors
     */
    function getRegisteredExecutors(
        uint256 _start, 
        uint256 _end
    ) 
        external view override
        returns (address[] memory _registeredExecutors, uint256 _totalLength)
    {
        address[] storage executors = registeredExecutors.list;
        _totalLength = executors.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _registeredExecutors = new address[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            _registeredExecutors[i - _start] = executors[i];
        }
    }

    /**
     * @notice Get the addresses of executors.
     */    
    function claimExecutors(address _owner) external view override returns (address[] memory) {
        return ownerClaimExecutorSet[_owner].list;
    }

    /**
     * @notice Returns the fee value of `_executor` at `_rewardEpoch`
     * @param _executor             address representing executor
     * @param _rewardEpoch          reward epoch number
     */
    function getExecutorFeeValue(address _executor, uint256 _rewardEpoch) external view override returns (uint256) {
        require(_rewardEpoch <= ftsoManager.getCurrentRewardEpoch() + feeValueUpdateOffset, ERR_REWARD_EPOCH_INVALID);
        return _getExecutorFeeValue(_executor, _rewardEpoch);
    }

    /**
     * @notice Returns the scheduled fee value changes of `_executor`
     * @param _executor             address representing executor
     * @return _feeValue            positional array of fee values
     * @return _validFromEpoch      positional array of reward epochs the fee setings are effective from
     * @return _fixed               positional array of boolean values indicating if settings are subjected to change
     */
    function getExecutorScheduledFeeValueChanges(address _executor)
        external view override
        returns (
            uint256[] memory _feeValue,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        ) 
    {
        ExecutorFee[] storage efs = claimExecutorFees[_executor];
        if (efs.length > 0) {
            uint256 currentEpoch = ftsoManager.getCurrentRewardEpoch();
            uint256 position = efs.length;
            while (position > 0 && efs[position - 1].validFromEpoch > currentEpoch) {
                position--;
            }
            uint256 count = efs.length - position;
            if (count > 0) {
                _feeValue = new uint256[](count);
                _validFromEpoch = new uint256[](count);
                _fixed = new bool[](count);
                for (uint256 i = 0; i < count; i++) {
                    _feeValue[i] = efs[i + position].value;
                    _validFromEpoch[i] = efs[i + position].validFromEpoch;
                    _fixed[i] = (_validFromEpoch[i] - currentEpoch) != feeValueUpdateOffset;
                }
            }
        }        
    }

    /**
     * @notice Returns some info about the `_executor`
     * @param _executor             address representing executor
     * @return _registered          information if executor is registered
     * @return _currentFeeValue     executor's current fee value
     */
    function getExecutorInfo(address _executor)
        external view override
        returns (
            bool _registered,
            uint256 _currentFeeValue
        )
    {
        _registered = registeredExecutors.index[_executor] != 0;
        _currentFeeValue = getExecutorCurrentFeeValue(_executor);
    }
    
    /**
     * @notice Returns the list of supported ftso reward managers.
     */
    function getFtsoRewardManagers() external view returns(IFtsoRewardManager[] memory) {
        return ftsoRewardManagers;
    }

    /**
     * @notice Returns the current fee value of `_executor`
     * @param _executor             address representing executor
     */
    function getExecutorCurrentFeeValue(address _executor) public view override returns (uint256) {
        return _getExecutorFeeValue(_executor, ftsoManager.getCurrentRewardEpoch());
    }

    /**
     * @notice Returns the delegation account data. If there is none it creates a new one. 
     */
    function _getOrCreateDelegationAccountData() internal returns (DelegationAccountData storage) {
        DelegationAccountData storage delegationAccountData = ownerToDelegationAccountData[msg.sender];
        if (address(delegationAccountData.delegationAccount) != address(0)) {
            return delegationAccountData;
        }
        require(libraryAddress != address(0), ERR_LIBRARY_ADDRESS_NOT_SET_YET);

        // create delegation account
        IIDelegationAccount delegationAccount = IIDelegationAccount(payable(createClone(libraryAddress)));
        require(_isContract(address(delegationAccount)), ERR_CREATE_CLONE);
        delegationAccount.initialize(msg.sender, this);
        delegationAccountData.delegationAccount = delegationAccount;
        emit DelegationAccountCreated(msg.sender, delegationAccount);

        return delegationAccountData;
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
        ftsoManager = IFtsoManager(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoManager"));
        WNat newWNat = WNat(payable(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat")));
        if (address(wNat) == address(0)) {
            wNat = newWNat;
        } else if (newWNat != wNat) {
            revert("wrong wNat address");
        }
        governanceVP = wNat.governanceVotePower();
        distribution = IDistributionToDelegators(
            _getContractAddress(_contractNameHashes, _contractAddresses, "DistributionToDelegators"));
        IFtsoRewardManager ftsoRewardManager = IFtsoRewardManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRewardManager"));
        bool rewardManagersContain = false;
        for (uint256 i = 0; i < ftsoRewardManagers.length; i++) {
            if (ftsoRewardManagers[i] == ftsoRewardManager) {
                rewardManagersContain = true;
                break;
            }
        }
        if (!rewardManagersContain) {
            ftsoRewardManagers.push(ftsoRewardManager);
        }
    }

    /**
     * @notice Internal method for claiming ftso rewards
     * @dev A fee is paid to executor only if claiming for everything (delegation account and owner) at the same time
     */
    function _claimFtsoRewards(
        address[] memory _owners,
        uint256[] memory _epochs,
        bool _claimForDelegationAccount,
        bool _claimForOwner
    )
        internal
        returns(uint256[] memory _amounts)
    {
        WNat wNatAddress = wNat;
        IFtsoRewardManager[] memory ftsoRewardManagersList = ftsoRewardManagers;
        uint256 fee = _claimForDelegationAccount && _claimForOwner ? getExecutorCurrentFeeValue(msg.sender) : 0;
        _amounts = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            DelegationAccountData memory delegationAccountData = ownerToDelegationAccountData[owner];
            IIDelegationAccount delegationAccount = delegationAccountData.delegationAccount;
            if (address(delegationAccount) != address(0)) {
                uint256 amount = delegationAccount.claimFtsoRewards(
                    wNatAddress,
                    ftsoRewardManagersList,
                    _epochs,
                    _claimForDelegationAccount && (!_claimForOwner || delegationAccountData.enabled),
                    _claimForOwner,
                    msg.sender,
                    fee
                );
                _amounts[i] = amount;
                emit FtsoRewardsClaimed(owner, delegationAccount, _epochs, amount);
            }
        }
    }

    /**
     * @notice Internal method for claiming airdrop distribution
     * @dev A fee is paid to executor only if claiming for everything (delegation account and owner) at the same time
     */
    function _claimAirdropDistribution(
        address[] memory _owners,
        uint256 _month,
        bool _claimForDelegationAccount,
        bool _claimForOwner
    )
        internal
        returns(uint256[] memory _amounts)
    {
        WNat wNatAddress = wNat;
        IDistributionToDelegators distributionAddress = distribution;
        uint256 fee = _claimForDelegationAccount && _claimForOwner ? getExecutorCurrentFeeValue(msg.sender) : 0;
        _amounts = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            DelegationAccountData memory delegationAccountData = ownerToDelegationAccountData[owner];
            IIDelegationAccount delegationAccount = delegationAccountData.delegationAccount;
            if (address(delegationAccount) != address(0)) {
                uint256 amount = delegationAccount.claimAirdropDistribution(
                    wNatAddress,
                    distributionAddress,
                    _month,
                    _claimForDelegationAccount && (!_claimForOwner || delegationAccountData.enabled),
                    _claimForOwner,
                    msg.sender,
                    fee
                );
                _amounts[i] = amount;
                emit AirdropDistributionClaimed(owner, delegationAccount, _month, amount);
            }
        }
    }

    /**
     * @notice Allows executor to set (or update last scheduled) fee value.
     * @param _currentRewardEpoch   current reward epoch number
     * @param _feeValue             number representing fee value
     * @return _validFromEpoch      Returns the reward epoch number when the setting becomes effective.
     */
    function _updateExecutorFeeValue(
        uint256 _currentRewardEpoch,
        uint256 _feeValue
    ) 
        internal
        returns (uint256 _validFromEpoch)
    {
        require(_feeValue <= maxFeeValueWei, ERR_FEE_INVALID);

        _validFromEpoch = _currentRewardEpoch + feeValueUpdateOffset;
        ExecutorFee[] storage efs = claimExecutorFees[msg.sender];

        // determine whether to update the last setting or add a new one
        uint256 position = efs.length;
        assert(position > 0); // this method can be called only after executor is registered
        uint256 lastValidFromEpoch = efs[position - 1].validFromEpoch;
        // do not allow updating the settings in the past - should never happen
        // (this can only happen if the current reward epoch is smaller than some previous one)
        require(_validFromEpoch >= lastValidFromEpoch, ERR_FEE_UPDATE_FAILED);
        
        if (_validFromEpoch == lastValidFromEpoch) { // update
            efs[position - 1].value = _feeValue;
        } else { // add
            efs.push(ExecutorFee({value: _feeValue, validFromEpoch: _validFromEpoch}));
        }

        emit ClaimExecutorFeeValueChanged(msg.sender, _validFromEpoch, _feeValue);
    }

    /**
     * @notice Returns delegation account for `_owner`.
     * @param _owner                owner's address
     */
    function _getDelegationAccount(address _owner) internal view returns (IIDelegationAccount) {
        return ownerToDelegationAccountData[_owner].delegationAccount;
    }

    /**
     * @notice Returns fee value setting for `_executor` at specified `_rewardEpoch`.
     * @param _executor             address representing executor
     * @param _rewardEpoch          reward epoch number
     */
    function _getExecutorFeeValue(
        address _executor,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint256)
    {
        ExecutorFee[] storage efs = claimExecutorFees[_executor];
        uint256 index = efs.length;
        while (index > 0) {
            index--;
            if (_rewardEpoch >= efs[index].validFromEpoch) {
                return efs[index].value;
            }
        }
        return 0;
    }

    /**
     * @notice Checks if caller is owner or executor for all addresses `_owners`.
     */
    function _checkOnlyOwnerOrExecutor(address[] memory _owners) internal view {
        for (uint256 i = 0; i < _owners.length; i++) {
            require(msg.sender == _owners[i] || ownerClaimExecutorSet[_owners[i]].index[msg.sender] != 0, 
                "only owner or executor");
        }
    }

    function _isContract(address _addr) private view returns (bool){
        uint32 size;
        // solhint-disable-next-line no-inline-assembly  
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }       
}
