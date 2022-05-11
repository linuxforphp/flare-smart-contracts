// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

// import "../../tokenPools/interface/IIFtsoRewardManager.sol";
// import "../../token/implementation/WNat.sol";
// import "../../userInterfaces/IDistribution.sol";
// import "../../token/interface/IIGovernanceVotePower.sol";
import "../interface/IDelegationAccount.sol";
import "./DelegationAccountManager.sol";

contract DelegationAccountClonable is IDelegationAccount {

    address public owner;
    // WNat private wNat;
    // IIFtsoRewardManager private ftsoRewardManager;
    // IIGovernanceVotePower private governanceVP;
    // IDistribution private distribution;
    DelegationAccountManager private manager;

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

    function initialize(
        address _owner,
        DelegationAccountManager _manager
    ) external {
        require(address(_owner) != address(0), "owner address missing");
        owner = _owner;
        manager = _manager;
        // emit Initialize(owner, ftsoRewardManager, distribution, governanceVP, wNat);
    }
    
    /**
     * @notice Allows user to claim ftso rewards for his delegation contract account
     * @param _epochs            epochs for which user wants to claim rewards
     * @dev Reverts if `msg.sender` is not an owner or executor
     */
    function claimFtsoRewards(uint256[] memory _epochs) external override onlyOwnerOrExecutor returns(uint256) {
        uint256 amount;
        for(uint256 i=0; i < manager.ftsoRewardManagersLength(); i++) {
            try manager.ftsoRewardManagers(i).claimAndWrapReward(payable(address(this)), _epochs)
            returns (uint256 _amount) {
                amount += _amount;
                emit ClaimFtsoRewards(address(this), _epochs, _amount,
                    IIFtsoRewardManager(address(manager.ftsoRewardManagers(i))));
            } catch Error(string memory _err) {
                emit StringFailure(_err);
            } catch (bytes memory _err) {
                emit BytesFailure(_err);
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
        for(uint256 i=0; i < manager.ftsoRewardManagersLength(); i++) {
            uint256[] memory epochs = manager.ftsoRewardManagers(i).getEpochsWithUnclaimedRewards(address(this));
            try manager.ftsoRewardManagers(i).claimAndWrapReward(payable(address(this)), epochs)
            returns (uint256 _amount) {
                amount += _amount;
                emit ClaimFtsoRewards(address(this), epochs, _amount,
                    IIFtsoRewardManager(address(manager.ftsoRewardManagers(i))));
            } catch Error(string memory _err) {
                emit StringFailure(_err);
            } catch (bytes memory _err) {
                emit BytesFailure(_err);
            }
        }
        return amount;
    }

    function claimAirdropDistribution() external override onlyOwnerOrExecutor returns(uint256) {
        uint256 amount;
        for(uint256 i=0; i < manager.distributionsLength(); i++) {
            try manager.distributions(i).claim() returns (uint256 _amount) {
                require(_amount > 0, "claimed amount should not be zero");
                amount += _amount;
                emit ClaimAirdrop(address(this), _amount);
            } catch Error(string memory _err) {
                emit StringFailure(_err);
            } catch (bytes memory _err) {
                emit BytesFailure(_err);
            }
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

    function getDelegatesOf() external view override 
    returns (
        address[] memory _delegateAddresses, 
        uint256[] memory _bips,
        uint256 _count,
        uint256 _delegationMode
    ) { 
        return manager.wNat().delegatesOf(address(this)); //only owner???
    }

    // function getDelegateOfGovernance() external view override returns(address) {
    //     return governanceVP.getDelegateOfAtNow(address(this));
    // }

    //delegatesOfAt??


}