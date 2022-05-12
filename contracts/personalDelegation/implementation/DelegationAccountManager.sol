// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./DelegationAccountClonable.sol";
import "./CloneFactory.sol";
import "../interface/IDelegationAccountManager.sol";
import "../../tokenPools/interface/IIFtsoRewardManager.sol";
import "../../token/implementation/WNat.sol";
import "../../userInterfaces/IDistribution.sol";
import "../../token/interface/IIGovernanceVotePower.sol";
import "../../governance/implementation/Governed.sol";

contract DelegationAccountManager is CloneFactory, IDelegationAccountManager, Governed {

    WNat public wNat;
    IIFtsoRewardManager[] public ftsoRewardManagers;
    IIGovernanceVotePower public governanceVP;
    IDistribution[] public distributions;

    address public libraryAddress;
    address private factoryOwner;

    mapping(address => address) public accountToDelegationAccount;

    constructor(
        address _governance,
        WNat _wNat,
        IIFtsoRewardManager _ftsoRewardManager,
        IDistribution _distribution,
        IIGovernanceVotePower _governanceVP
    ) 
        Governed(_governance)
    {
        require(address(_governance) != address(0), "governance address should not be zero");
        require(address(_ftsoRewardManager) != address(0), "ftso reward manager 0");
        require(address(_distribution) != address(0), "distribution contract 0");
        require(address(_governanceVP) != address(0), "governance VP 0");
        require(address(_wNat) != address(0), "wNat 0");
        ftsoRewardManagers.push(_ftsoRewardManager);
        distributions.push(_distribution);
        governanceVP = _governanceVP;
        wNat = _wNat;
        factoryOwner = _governance;
        emit SetLibraryAddress(libraryAddress);
    }

    function setLibraryAddress(address _libraryAddress) external override onlyGovernance {
        libraryAddress = _libraryAddress;
        emit SetLibraryAddress(libraryAddress);
    }

    function createDelegationAccount() external override {
        require(libraryAddress != address(0), "library address is not set yet");
        require(accountToDelegationAccount[msg.sender] == address(0), "account already has delegation account");

        DelegationAccountClonable delegationAccount = DelegationAccountClonable(
            payable(createClone(libraryAddress))
        );

        delegationAccount.initialize(msg.sender, this);
            
        accountToDelegationAccount[msg.sender] = address(delegationAccount);

        emit CreateDelegationAccount(address(delegationAccount), msg.sender);
    }

    function addFtsoRewardManager(IIFtsoRewardManager _ftsoRewardManager) external override onlyGovernance {
        ftsoRewardManagers.push(_ftsoRewardManager);
    }

    function addDistribution(IDistribution _distribution) external override onlyGovernance {
        distributions.push(_distribution);
    }

    function ftsoRewardManagersLength() external view override returns(uint256) {
        return ftsoRewardManagers.length;
    }

    function distributionsLength() external view override returns(uint256) {
        return distributions.length;
    }
}