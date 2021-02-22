// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IFAssetBase.sol";


interface IFAsset {
    
    /// addRewardToAgentPosition function will be triggered by the reward contract per reward allocation.
    /// Function will claim rewards for last epoch, and allocate to relevant agents
    /// Flow:
    ///     - check which FTSO won.
    ///     - claim relevant reward from reward contract.
    ///     - iterate list of current delegators to this FTSO
    ///     - per the list, check weight agent delegated to this FTSO
    ///     - add FLR reward to this Agent position. 
    function addRewardToAgentPosition(uint256 epochID) external returns (bool succeess);
    
    enum FeeHandling {
        DEPOSIT_TO_POSITION,
        SEND_TO_AGENT
    }

    function deposit(
        uint256 amount,
        uint256 freshMint, // amount to add to fresh minting pool
        uint256 agentPosition, // amount to add to position pool 
        uint256 freshMintMinRatio, // if position pool collateral ratio < min, no new mints
        address FLRAddress,
        FeeHandling handling
        ) external;

    /// note: must send collateral reservation fee as msg.value. or approve to this contract
    function mintRequest ( // AKA collateral reservation
        uint256 mintAmountTwei,
        address mintDestination,
        bytes32 underlyingAddress
    ) external returns (
        uint256 mintRequestId,
        address[] agents, // agent list
        uint256[] assetAmounts, // amount to send to agent in underlying chain
        bytes32[] assetAddress  // underlying chain address
    );

    function proveMintPayment ( // AKA mint
        uint256 mintRequestId,
        bytes32 minterSourceAddress, //do we need this?
        bytes32 agentAssetAddress,
        bytes32 destinationTag,
        uint256 assetAmount,
        bytes32[] merkleProof
    ) external returns (
        uint256 mintedAmount
    );

    function assetRedemptionRequest (
        uint256 amount,
        bytes32 assetAddress // address in underlying chain[]
    ) external returns (
        uint256 redemptionId,
        address[] agents, // agent list
        uint256[] assetAmounts // amount agent should  in underlying chain
    );

    function proveRedemptionPayment ( // same as prove mint payment?
        uint256 redemptionRequestId,
        bytes32 agentSourceAssetAddress, //do we need this?
        bytes32 redeemerAssetAddress,
        bytes32 destinationTag,
        uint256 assetAmount,
        bytes32[] merkleProof
    ) external returns (
        uint256 redeemedAmount
    );
}
