// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


import "../../userInterfaces/IDelegationAccount.sol";
import "../interface/IIDelegationAccountManager.sol";

interface IIDelegationAccount is IDelegationAccount {

    /**
     * Initialization of a new deployed contract
     * @param _owner                        contract owner address
     * @param _manager                      contract manager address
     */
    function initialize(address _owner, IIDelegationAccountManager _manager) external;

    /**
     * @notice Enables this contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will remain on delegation account and 
     * will not be automatically transfered to owner's account.
     */    
    function enableClaimingToDelegationAccount() external;

    /**
     * @notice Disables this contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will not remain on delegation account but 
     * will be automatically transfered to owner's account.
     * @notice Automatic claiming will not claim ftso rewards and airdrop for delegation account anymore.
     * @param _wNat                         WNat contract address
     */ 
    function disableClaimingToDelegationAccount(WNat _wNat) external;

    /**
     * @notice Allows user or executor to claim ftso rewards for delegation and owner accounts
     * @notice If called by `_executor` and `_executorFee` > 0, the fee is paid to executor
     * @param _wNat                         WNat contract address
     * @param _rewardManagers               array of ftso reward managers
     * @param _epochs                       epochs for which to claim ftso rewards
     * @param _claimForDelegationAccount    indicates if claiming for delegation account
     * @param _claimForOwner                indicates if claiming for owner
     * @param _executor                     the address of the executor
     * @param _executorFee                  the fee that should be paid to the executor if not owner
     */
    function claimFtsoRewards(
        WNat _wNat,
        IFtsoRewardManager[] memory _rewardManagers,
        uint256[] memory _epochs,
        bool _claimForDelegationAccount,
        bool _claimForOwner,
        address _executor,
        uint256 _executorFee
    ) external returns(uint256 _amount);

    /**
     * @notice Allows user or executor to claim airdrop for delegation and owner accounts
     * @notice If called by `_executor` and `_executorFee` > 0, the fee is paid to executor
     * @param _wNat                         WNat contract address
     * @param _distribution                 distribution contract address
     * @param _month                        month for which to claim airdrop
     * @param _claimForDelegationAccount    indicates if claiming for delegation account
     * @param _claimForOwner                indicates if claiming for owner
     * @param _executor                     the address of the executor
     * @param _executorFee                  the fee that should be paid to the executor if not owner
     */
    function claimAirdropDistribution(
        WNat _wNat,
        IDistributionToDelegators _distribution,
        uint256 _month,
        bool _claimForDelegationAccount,
        bool _claimForOwner,
        address _executor,
        uint256 _executorFee
    ) external returns(uint256 _amount);


    function delegate(WNat _wNat, address _to, uint256 _bips) external;

    function batchDelegate(WNat _wNat, address[] memory _delegatees, uint256[] memory _bips) external;

    function undelegateAll(WNat _wNat) external;

    function revokeDelegationAt(WNat _wNat, address _who, uint256 _blockNumber) external;

    function delegateGovernance(IGovernanceVotePower _governanceVP, address _to) external;

    function undelegateGovernance(IGovernanceVotePower _governanceVP) external;

    function withdraw(WNat _wNat, uint256 _amount) external;
    
    function transferExternalToken(WNat _wNat, IERC20 _token, uint256 _amount) external;
}
