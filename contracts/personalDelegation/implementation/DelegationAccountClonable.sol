// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIDelegationAccount.sol";
import "../interface/IIDelegationAccountManager.sol";
import "@openzeppelin/contracts/math/Math.sol";


contract DelegationAccountClonable is IIDelegationAccount {

    string internal constant ERR_TRANSFER_FAILURE = "transfer failed";
    string internal constant ERR_CLAIM_FAILURE = "unknown error when claiming";
    string internal constant ERR_CLAIMED_AMOUNT_TOO_SMALL = "claimed amount too small";
    string internal constant ERR_MANAGER_ONLY = "only manager";

    address public owner;
    bool public claimToDelegationAccount;
    IIDelegationAccountManager public manager;

    /**
     * Some external methods in DelegationAccount contract can only be executed by the manager.
     */
    modifier onlyManager {
        _checkOnlyManager();
        _;
    }

    receive() external payable {
        manager.wNat().deposit{value: msg.value}();
    }

    /**
     * Initialization of a new deployed contract
     * @param _owner                        contract owner address
     * @param _manager                      contract manager address
     */
    function initialize(
        address _owner,
        IIDelegationAccountManager _manager
    )
        external override
    {
        require(address(owner) == address(0), "owner already set");
        require(address(_owner) != address(0), "owner address zero");
        require(address(_manager) != address(0), "manager address zero");
        owner = _owner;
        manager = _manager;
        emit Initialize(owner, _manager);
    }

    /**
     * @notice Enables this contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will remain on delegation account and 
     * will not be automatically transfered to owner's account.
     */    
    function enableClaimingToDelegationAccount() external override onlyManager {
        claimToDelegationAccount = true;
    }

    /**
     * @notice Disables this contract to be used as delegation account,
     * i.e. all ftso rewards and airdrop funds will not remain on delegation account but 
     * will be automatically transfered to owner's account.
     * @notice Automatic claiming will not claim ftso rewards and airdrop for delegation account anymore.
     * @param _wNat                         WNat contract address
     */ 
    function disableClaimingToDelegationAccount(WNat _wNat) external override onlyManager {
        claimToDelegationAccount = false;
        _transferFundsToOwner(_wNat);
    }

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
    )
        external override onlyManager
        returns(uint256 _amount)
    {
        for (uint256 i = 0; i < _rewardManagers.length; i++) {
            if (_claimForDelegationAccount) {
                _amount += _claimDelegationAccountFtsoRewards(_rewardManagers[i], _epochs);
            }
            if (_claimForOwner) {
                _amount += _claimOwnerFtsoRewards(_rewardManagers[i], _epochs);
            }
        }
        if (_executor != owner && _executorFee > 0) {
            _payFeeToExecutor(_wNat, _executor, _executorFee, _amount);
        }
        if (!claimToDelegationAccount) {
            _transferFundsToOwner(_wNat);
        }
    }

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
    )
        external override onlyManager
        returns(uint256 _amount)
    {
        if (_claimForDelegationAccount) {
            _amount += _claimDelegationAccountAirdropDistribution(_distribution, _month);
        }
        if (_claimForOwner) {
            _amount += _claimOwnerAirdropDistribution(_distribution, _month);
        }
        if (_executor != owner && _executorFee > 0) {
            _payFeeToExecutor(_wNat, _executor, _executorFee, _amount);
        }
        if (!claimToDelegationAccount) {
            _transferFundsToOwner(_wNat);
        }
    }

    function delegate(WNat _wNat, address _to, uint256 _bips) external override onlyManager {
        _wNat.delegate(_to, _bips);
        emit DelegateFtso(address(this), _to, _bips);
    }

    function undelegateAll(WNat _wNat) external override onlyManager {
        _wNat.undelegateAll();
        emit UndelegateAllFtso(address(this));
    }

    function revokeDelegationAt(WNat _wNat, address _who, uint256 _blockNumber) external override onlyManager {
        _wNat.revokeDelegationAt(_who, _blockNumber);
    }

    function delegateGovernance(IGovernanceVotePower _governanceVP, address _to) external override onlyManager {
        _governanceVP.delegate(_to);
        emit DelegateGovernance(address(this), _to);
    }

    function undelegateGovernance(IGovernanceVotePower _governanceVP) external override onlyManager {
        _governanceVP.undelegate();
        emit UndelegateGovernance(address(this));
    }

    function withdraw(WNat _wNat, uint256 _amount) external override onlyManager {
        bool success = _wNat.transfer(owner, _amount);
        require(success, ERR_TRANSFER_FAILURE);
        emit WithdrawToOwner(address(this), _amount);
    }

    /**
     * @notice Allows user to transfer balance of ERC20 tokens owned by the personal delegation contract.
     The main use case is to transfer tokens/NFTs that were received as part of an airdrop or register 
     as participant in such airdrop.
     * @param _token            Target token contract address
     * @param _amount           Amount of tokens to transfer
     * @dev Reverts if target token is WNat contract
     */
    function transferExternalToken(WNat _wNat, IERC20 _token, uint256 _amount) external override onlyManager {
        require(address(_token) != address(_wNat), "Transfer from wNat not allowed");
        bool success = _token.transfer(owner, _amount);
        require(success, ERR_TRANSFER_FAILURE);
    }

    function _claimDelegationAccountFtsoRewards(IFtsoRewardManager _rewardManager, uint256[] memory _epochs)
        internal
        returns(uint256 _amount)
    {
        try _rewardManager.claim(address(this), address(this), _epochs, false) returns (uint256 amount) {
            emit ClaimFtsoRewards(address(this), _epochs, amount, _rewardManager, false);
            return amount;
        } catch Error(string memory _err) {
            emit ClaimFtsoRewardsFailure(_err, _rewardManager, false);
        } catch {
            emit ClaimFtsoRewardsFailure(ERR_CLAIM_FAILURE, _rewardManager, false);
        }
    }

    function _claimOwnerFtsoRewards(IFtsoRewardManager _rewardManager, uint256[] memory _epochs)
        internal
        returns(uint256 _amount)
    {
        try _rewardManager.claim(owner, address(this), _epochs, false) returns (uint256 amount) {
            emit ClaimFtsoRewards(address(this), _epochs, amount, _rewardManager, true);
            return amount;
        } catch Error(string memory _err) {
            emit ClaimFtsoRewardsFailure(_err, _rewardManager, true);
        } catch {
            emit ClaimFtsoRewardsFailure(ERR_CLAIM_FAILURE, _rewardManager, true);
        }
    }

    function _claimDelegationAccountAirdropDistribution(IDistributionToDelegators _distribution, uint256 _month)
        internal
        returns(uint256 _amount)
    {
        try _distribution.claim(address(this), _month) returns (uint256 amount) {
            emit ClaimAirdropDistribution(address(this), _month, amount, _distribution, false);
            return amount;
        } catch Error(string memory _err) {
            emit ClaimAirdropDistributionFailure(_err, _distribution, false);
        } catch {
            emit ClaimAirdropDistributionFailure(ERR_CLAIM_FAILURE, _distribution, false);
        }
    }

    function _claimOwnerAirdropDistribution(IDistributionToDelegators _distribution, uint256 _month)
        internal
        returns(uint256 _amount)
    {
        try _distribution.claimToPersonalDelegationAccountByExecutor(owner, _month) returns (uint256 amount) {
            emit ClaimAirdropDistribution(address(this), _month, amount, _distribution, true);
            return amount;
        } catch Error(string memory _err) {
            emit ClaimAirdropDistributionFailure(_err, _distribution, true);
        } catch {
            emit ClaimAirdropDistributionFailure(ERR_CLAIM_FAILURE, _distribution, true);
        }
    }

    function _payFeeToExecutor(WNat _wNat, address _executor, uint256 _executorFee, uint256 _claimedAmount) internal {
        require(_claimedAmount > _executorFee, ERR_CLAIMED_AMOUNT_TOO_SMALL);
        bool success = _wNat.transfer(_executor, _executorFee);
        require(success, ERR_TRANSFER_FAILURE);
        emit ExecutorFeePaid(address(this), _executor, _executorFee);
    }

    function _transferFundsToOwner(WNat _wNat) internal {
        uint256 balance = _wNat.balanceOf(address(this));
        if (balance > 0) {
            bool success = _wNat.transfer(owner, balance);
            require(success, ERR_TRANSFER_FAILURE);
            emit WithdrawToOwner(address(this), balance);
        }
    }

    function _checkOnlyManager() internal view {
        require(msg.sender == address(manager), ERR_MANAGER_ONLY);
    }
}
