// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IDelegationAccount.sol";
import "./DelegationAccountManager.sol";

contract DelegationAccountClonable is IDelegationAccount {

    string internal constant CLAIM_FAILURE = "unknown error when claiming";

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
        require(msg.sender == owner || 
        isExecutor[msg.sender] == true, 
        "only owner or executor account");
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
            try rewardManagers[i].claimAndWrapReward(address(this), _epochs) returns (uint256 _amount) {
                amount += _amount;
                emit ClaimFtsoRewards(address(this), _epochs, _amount, rewardManagers[i]);
            } catch Error(string memory _err) {
                emit ClaimingFailure(_err);
            } catch {
                emit ClaimingFailure(CLAIM_FAILURE);
            }
        }
        return amount;
    }

    /**
     * @notice Allows user to claim all unclaimed ftso rewards for his delegation contract account
     * @dev Reverts if `msg.sender` is not an owner
     */
    function claimAllFtsoRewards() external override onlyOwnerOrExecutor returns(uint256) {
        uint256 amount;
        IIFtsoRewardManager[] memory rewardManagers = manager.getFtsoRewardManagers();
        for(uint256 i = 0; i < rewardManagers.length; i++) {
            uint256[] memory epochs = rewardManagers[i].getEpochsWithUnclaimedRewards(address(this));
            try rewardManagers[i].claimAndWrapReward(address(this), epochs) returns (uint256 _amount) {
                amount += _amount;
                emit ClaimFtsoRewards(address(this), epochs, _amount, rewardManagers[i]);
            } catch Error(string memory _err) {
                emit ClaimingFailure(_err);
            } catch {
                emit ClaimingFailure(CLAIM_FAILURE);
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
                emit ClaimingFailure(_err);
            } catch {
                emit ClaimingFailure(CLAIM_FAILURE);
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

    function delegateGovernance(address _to) external override onlyOwner { 
        manager.governanceVP().delegate(_to);
        emit DelegateGovernance(address(this), _to);
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

    function getDelegatesOf()
        external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        return manager.wNat().delegatesOf(address(this));
    }

    function getDelegateOfGovernance() external view override returns(address) {
        return manager.governanceVP().getDelegateOfAtNow(address(this));
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
                emit ClaimingFailure(_err);
            } catch {
                emit ClaimingFailure(CLAIM_FAILURE);
            }
        }
        return amount;
    }
}
