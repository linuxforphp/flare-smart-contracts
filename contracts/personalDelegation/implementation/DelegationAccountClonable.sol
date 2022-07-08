// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IDelegationAccount.sol";
import "./DelegationAccountManager.sol";

contract DelegationAccountClonable is IDelegationAccount {

    string internal constant CLAIM_FAILURE = "unknown error when claiming";
    string internal constant UNCLAIMED_EPOCHS_FAILURE = "unknown error when claiming";

    address public owner;
    DelegationAccountManager public manager;

    mapping(address => bool) public isExecutor;

    /**
     * Some external methods in DelegationAccount contract can only be executed by the owner account.
     */
    modifier onlyOwner {
        require(msg.sender == owner, "only owner account");
        _;
    }

    /**
     * Some external methods in DelegationAccount contract can only be executed by the owner 
    or executor account.
     */
    modifier onlyOwnerOrExecutor {
        require(msg.sender == owner || isExecutor[msg.sender], "only owner or executor account");
        _;
    }

    receive() external payable {
        manager.wNat().deposit{value: msg.value}();
    }

    function initialize(address _owner, DelegationAccountManager _manager) external {
        require(address(owner) == address(0), "owner already set");
        require(address(_owner) != address(0), "owner address missing");
        owner = _owner;
        manager = _manager;
        emit Initialize(owner, _manager);
    }
    
    /**
     * @notice Allows user to claim ftso rewards for his delegation contract account
     * @param _epochs            epochs for which user wants to claim rewards
     * @dev Reverts if `msg.sender` is not an owner or executor
     */
    function claimFtsoRewards(uint256[] memory _epochs) external override onlyOwnerOrExecutor returns(uint256) {
        uint256 amount;
        IIFtsoRewardManager[] memory rewardManagers = manager.getFtsoRewardManagers();
        for(uint256 i=0; i < rewardManagers.length; i++) {
            try rewardManagers[i].claimReward(address(this), _epochs) returns (uint256 _amount) {
                amount += _amount;
                emit ClaimFtsoRewards(address(this), _epochs, _amount, rewardManagers[i]);
            } catch Error(string memory _err) {
                emit ClaimFtsoFailure(_err, rewardManagers[i]);
            } catch {
                emit ClaimFtsoFailure(CLAIM_FAILURE, rewardManagers[i]);
            }
        }
        return amount;
    }

    /**
     * @notice Allows user to claim all unclaimed ftso rewards for his delegation contract account
     * @dev Reverts if `msg.sender` is not an owner or executor
     */
    function claimAllFtsoRewards() external override onlyOwnerOrExecutor returns(uint256) {
        uint256 amount;
        IIFtsoRewardManager[] memory rewardManagers = manager.getFtsoRewardManagers();
        for(uint256 i = 0; i < rewardManagers.length; i++) {
            try rewardManagers[i].getEpochsWithUnclaimedRewards(address(this)) returns(uint256[] memory epochs) {
                try rewardManagers[i].claimReward(address(this), epochs) returns (uint256 _amount) {
                    amount += _amount;
                    emit ClaimFtsoRewards(address(this), epochs, _amount, rewardManagers[i]);
                } catch Error(string memory _err) {
                    emit ClaimFtsoFailure(_err, rewardManagers[i]);
                } catch {
                    emit ClaimFtsoFailure(CLAIM_FAILURE, rewardManagers[i]);
                }
            } catch Error(string memory _err) {
                    emit EpochsWithUnclaimedRewardsFailure(_err, rewardManagers[i]);
            } catch {
                    emit EpochsWithUnclaimedRewardsFailure(UNCLAIMED_EPOCHS_FAILURE, rewardManagers[i]);
            }
        }
        return amount;
    }

    function claimAirdropDistribution(uint256 _month) external override onlyOwnerOrExecutor returns(uint256) {
        uint256 amount;
        IDistributionToDelegators[] memory distributions = manager.getDistributions();
        for(uint256 i = 0; i < distributions.length; i++) {
            try distributions[i].claim(address(this), _month) returns (uint256 _amount) {
                if (_amount > 0) {
                    amount += _amount;
                    emit ClaimAirdrop(address(this), _amount, _month, distributions[i]);
                }
            } catch Error(string memory _err) {
                emit ClaimDistributionFailure(_err, distributions[i]);
            } catch {
                emit ClaimDistributionFailure(CLAIM_FAILURE, distributions[i]);
            }
        }
        return amount;
    }

    function claimAllUnclaimedAirdropDistribution() external onlyOwnerOrExecutor returns(uint256) {
        uint256 amount;
        IDistributionToDelegators[] memory distributions = manager.getDistributions();
        for(uint256 i = 0; i < distributions.length; i++) {
            uint256 _amount = _claimAirdrop(distributions[i]);
            amount += _amount;
        }
        return amount;
    }

    function delegate(address _to, uint256 _bips) external override onlyOwner { 
        manager.wNat().delegate(_to, _bips);
        emit DelegateFtso(address(this), _to, _bips);
    }

    function undelegateAll() external override onlyOwner {
        manager.wNat().undelegateAll();
        emit UndelegateAllFtso(address(this));
    }

    function revokeDelegationAt(address _who, uint256 _blockNumber) external override onlyOwner {
        manager.wNat().revokeDelegationAt(_who, _blockNumber);
    }

    function delegateGovernance(address _to) external override onlyOwner { 
        manager.governanceVP().delegate(_to);
        emit DelegateGovernance(address(this), _to, manager.wNat().balanceOf(address(this)));
    }

    function undelegateGovernance() external override onlyOwner {
        manager.governanceVP().undelegate();
        emit UndelegateGovernance(address(this));
    }

    function setExecutor(address _executor) external override onlyOwner {
        isExecutor[_executor] = true;
        emit SetExecutor(address(this), _executor);
    }

    function removeExecutor(address _executor) external override onlyOwner {
        isExecutor[_executor] = false;
        emit RemoveExecutor(address(this), _executor);
    }

    function withdraw(uint256 _amount) external override onlyOwner {
        bool returnValue = manager.wNat().transfer(owner, _amount);
        require(returnValue == true, "transfer failed");
        emit WidthrawToOwner(address(this), _amount);
    }

    /**
     * @notice Allows user to transfer balance of ERC20 tokens owned by the personal delegation contract.
     The main use case is to transfer tokens/NFTs that were received as part of an airdrop or register 
     as participant in such airdrop.
     * @param _token            Target token contract address
     * @param _amount           Amount of tokens to transfer
     * @dev Reverts if `msg.sender` is not an owner or the target token in WNat contract
     */
    function transferExternalToken(IERC20 _token, uint256 _amount) external override onlyOwner {
        require(address(_token) != address(manager.wNat()), "Transfer from wNat not allowed");
        bool returnValue = _token.transfer(owner, _amount);
        require(returnValue == true, "transfer failed");
    }
    
    function _claimAirdrop(IDistributionToDelegators _distribution) internal returns (uint256) {
        uint maxMonth = Math.min(_distribution.getCurrentMonth(), 36);
        uint256 amount;
        for (uint256 month = _distribution.getMonthToExpireNext(); month < maxMonth; month++) {
            try _distribution.claim(address(this), month) returns (uint256 _amount) {
                if (_amount > 0) {
                    amount += _amount;
                    emit ClaimAirdrop(address(this), _amount, month, _distribution);
                }
            } catch Error(string memory _err) {
                emit ClaimDistributionFailure(_err, _distribution);
            } catch {
                emit ClaimDistributionFailure(CLAIM_FAILURE, _distribution);
            }
        }
        return amount;
    }
}
