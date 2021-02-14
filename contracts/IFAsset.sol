// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IFAssetBase.sol";


interface IFAsset is IFAssetBase {

    /// book keeping delegation DATA
    ////////////////////////////////
    /// array of addresses delegating to which data provider and which weight
    /// how much 
    struct DelegateData {
        uint256 votePower;
        address agent;
    }
    // per data provider. list of delegating agents.
    mapping (address => DelegateData[]) agentDelegations;

    /// claimRewards function will be triggered by the reward contract per reward allocation.
    /// Function will claim rewards for last epoch, and allocate to relevant agents
    /// Flow:
    ///     - check which FTSO won.
    ///     - claim relevant reward from reward contract.
    ///     - iterate list of current delegators to this FTSO
    ///     - per the list, check weight agent delegated to this FTSO
    ///     - add FLR reward to this Agent position. 
    function claimRewards(uint256 epochID) external returns (bool succeess);
    
    function deposit()
}
