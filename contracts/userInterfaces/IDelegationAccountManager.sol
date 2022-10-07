// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IDelegationAccount.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDelegationAccountManager {

    event CreateDelegationAccount(address owner, address delegationAccount);
    event FtsoRewardsClaimed(
        address owner, IDelegationAccount delegationAccount, uint256[] rewardEpochs, uint256 amount);
    event AirdropDistributionClaimed(
        address owner, IDelegationAccount delegationAccount, uint256 month, uint256 amount);
    event ClaimExecutorsChanged(address owner, address[] executors);
    event ClaimExecutorFeeValueChanged(address executor, uint256 validFromRewardEpoch, uint256 feeValueWei);
    event ExecutorRegistered(address executor);
    event ExecutorUnregistered(address executor, uint256 validFromRewardEpoch);
    event FtsoRewarManagerRemoved(address ftsoRewardManager);

    /**
     * @notice Sets the addresses of executors and creates delegation account contract if it does not exist.
     * @notice If setting registered executors some fee must be paid to them.
     * @param _executors        The new executors. All old executors will be deleted and replaced by these.
     * @return Address of delegation account contract.
     */ 
    function setClaimExecutors(address[] memory _executors) external payable returns (IDelegationAccount);

    /**
     * @notice Enables (creates) delegation account contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will remain on delegation account and 
     * will not be automatically transfered to owner's account.
     * @return Address of delegation account contract.
     */
    function enableDelegationAccount() external returns (IDelegationAccount);

    /**
     * @notice Disables delegation account contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will not remain on delegation account but 
     * will be automatically transfered to owner's account.
     * @notice Automatic claiming will not claim ftso rewards and airdrop for delegation account anymore.
     * @dev Reverts if there is no delegation account
     */
    function disableDelegationAccount() external;

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
        external
        returns(uint256[] memory);

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
        external
        returns(uint256[] memory);

    /**
     * @notice Claim ftso rewards for delegation account and owner
     * @notice If called by executor a fee is transfered to executor or transaction is reverted (claimed amount to low)
     * @param _owners       list of owner addresses
     * @param _epochs       list of epochs to claim for
     * @return              Array of claimed amounts
     */
    function claimFtsoRewards(
        address[] memory _owners,
        uint256[] memory _epochs
    )
        external
        returns(uint256[] memory);

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
        external
        returns(uint256[] memory);

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
        external
        returns(uint256[] memory);

    /**
     * @notice Claim airdrop distribution for delegation account and owner
     * @notice If called by executor a fee is transfered to executor or transaction is reverted (claimed amount to low)
     * @param _owners       list of owner addresses
     * @param _month        month to claim for
     * @return              Array of claimed amounts
     */
    function claimAirdropDistribution(
        address[] memory _owners,
        uint256 _month
    )
        external
        returns(uint256[] memory);

    /**
     * @notice Allows executor to register and set initial fee value.
     * If executor was already registered before (has fee set), only update fee after `feeValueUpdateOffset`.
     * @notice Executor must pay fee in order to register - `registerExecutorFeeValueWei`.
     * @param _feeValue    number representing fee value
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function registerExecutor(uint256 _feeValue) external payable returns (uint256);

    /**
     * @notice Allows executor to unregister.
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function unregisterExecutor() external returns (uint256);

    /**
     * @notice Allows registered executor to set (or update last scheduled) fee value.
     * @param _feeValue    number representing fee value
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function updateExecutorFeeValue(uint256 _feeValue) external returns(uint256);

    /**
     * @notice Delegate `_bips` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(address _to, uint256 _bips) external;

    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     **/
    function undelegateAll() external;

    /**
    * @notice Revoke all delegation from sender to `_who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    *    Block `_blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    */
    function revokeDelegationAt(address _who, uint256 _blockNumber) external;

    /**
     * @notice Delegate all governance vote power of `msg.sender` to `_to`.
     * @param _to The address of the recipient
     **/
    function delegateGovernance(address _to) external;

    /**
     * @notice Undelegate governance vote power.
     **/
    function undelegateGovernance() external;

    /**
     * @notice Allows user to transfer WNat to owner's account.
     * @param _amount           Amount of tokens to transfer
     */
    function withdraw(uint256 _amount) external;

    /**
     * @notice Allows user to transfer balance of ERC20 tokens owned by the personal delegation contract.
     The main use case is to transfer tokens/NFTs that were received as part of an airdrop or register 
     as participant in such airdrop.
     * @param _token            Target token contract address
     * @param _amount           Amount of tokens to transfer
     * @dev Reverts if target token is WNat contract - use method `withdraw` for that
     */
    function transferExternalToken(IERC20 _token, uint256 _amount) external;

    /**
     * @notice Gets the delegation account of the `_owner`. Returns address(0) if not created yet.
     */
    function accountToDelegationAccount(address _owner) external view returns (address);

    /**
     * @notice Gets the delegation account data for the `_owner`. Returns address(0) if not created yet.
     * @param _owner                        owner's address
     * @return _delegationAccount           owner's delegation account address - could be address(0)
     * @return _enabled                     indicates if delegation account is enabled
     */
    function getDelegationAccountData(
        address _owner
    )
        external view
        returns (IDelegationAccount _delegationAccount, bool _enabled);

    /**
     * @notice Get the addresses of executors.
     */    
    function claimExecutors(address _owner) external view returns (address[] memory);

    /**
     * @notice Returns info if `_executor` is allowed to execute calls for `_owner`
     */
    function isClaimExecutor(address _owner, address _executor) external view returns(bool);

    /**
     * @notice Get registered executors
     */
    function getRegisteredExecutors(
        uint256 _start, 
        uint256 _end
    ) 
        external view
        returns (address[] memory _registeredExecutors, uint256 _totalLength);

    /**
     * @notice Returns some info about the `_executor`
     * @param _executor             address representing executor
     * @return _registered          information if executor is registered
     * @return _currentFeeValue     executor's current fee value
     */
    function getExecutorInfo(address _executor) external view returns (bool _registered, uint256 _currentFeeValue);

    /**
     * @notice Returns the current fee value of `_executor`
     * @param _executor             address representing executor
     */
    function getExecutorCurrentFeeValue(address _executor) external view  returns (uint256);

    /**
     * @notice Returns the fee value of `_executor` at `_rewardEpoch`
     * @param _executor             address representing executor
     * @param _rewardEpoch          reward epoch number
     */
    function getExecutorFeeValue(address _executor, uint256 _rewardEpoch) external view returns (uint256);

    /**
     * @notice Returns the scheduled fee value changes of `_executor`
     * @param _executor             address representing executor
     * @return _feeValue            positional array of fee values
     * @return _validFromEpoch      positional array of reward epochs the fee setings are effective from
     * @return _fixed               positional array of boolean values indicating if settings are subjected to change
     */
    function getExecutorScheduledFeeValueChanges(address _executor)
        external view
        returns (
            uint256[] memory _feeValue,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        );
}
