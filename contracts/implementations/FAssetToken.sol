// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {ICollateralizable} from "../ICollateralizable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {VPToken} from "./VPToken.sol";

/**
 * @title FAsset Token
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block, and collateralized minting.
 **/
contract FAssetToken is AccessControl, ICollateralizable, VPToken {
    using SafeMath for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    constructor(
        string memory name_, 
        string memory symbol_) VPToken(name_, symbol_) {

        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

        _setupRole(MINTER_ROLE, _msgSender());
    }

    /// addRewardToAgentPosition function will be triggered by the reward contract per reward allocation.
    /// Function will claim rewards for last epoch, and allocate to relevant agents
    /// Flow:
    ///     - check which FTSO won.
    ///     - claim relevant reward from reward contract.
    ///     - iterate list of current delegators to this FTSO
    ///     - per the list, check weight agent delegated to this FTSO
    ///     - add FLR reward to this Agent position. 
    function addRewardToAgentPosition(uint256 epochID) external override returns (bool succeess) {
        revert("Not implemented");
    }
    
    function deposit(
        uint256 amount,
        uint256 freshMint, // amount to add to fresh minting pool
        uint256 agentPosition, // amount to add to position pool 
        uint256 freshMintMinRatio, // if position pool collateral ratio < min, no new mints
        address flrAddress,
        FeeHandling handling
        ) external override {

        revert("Not implemented");
    }

    /// note: must send collateral reservation fee as msg.value. or approve to this contract
    function mintRequest ( // AKA collateral reservation
        uint256 mintAmountTwei,
        address mintDestination,
        bytes32 underlyingAddress
    ) external override returns (
        uint256 mintRequestId,
        address[] memory agents, // agent list
        uint256[] memory assetAmounts, // amount to send to agent in underlying chain
        bytes32[] memory assetAddress  // underlying chain address
    ){
        require(hasRole(MINTER_ROLE, _msgSender()), "must have minter role");

        _mint(mintDestination, mintAmountTwei.mul(1000));

        return (0, agents, assetAmounts, assetAddress);
    }

    function proveMintPayment ( // AKA mint
        uint256 mintRequestId,
        bytes32 minterSourceAddress, //do we need this?
        bytes32 agentAssetAddress,
        bytes32 destinationTag,
        uint256 assetAmount,
        bytes32[] calldata merkleProof
    ) external override returns (
        uint256 mintedAmount
    ){
        revert("Not implemented");
    }

    function assetRedemptionRequest (
        uint256 amount,
        bytes32 assetAddress // address in underlying chain[]
    ) external override returns (
        uint256 redemptionId,
        address[] calldata agents, // agent list
        uint256[] calldata assetAmounts // amount agent should  in underlying chain
    ){
        revert("Not implemented");
    }

    function proveRedemptionPayment ( // same as prove mint payment?
        uint256 redemptionRequestId,
        bytes32 agentSourceAssetAddress, //do we need this?
        bytes32 redeemerAssetAddress,
        bytes32 destinationTag,
        uint256 assetAmount,
        bytes32[] calldata merkleProof
    ) external override returns (
        uint256 redeemedAmount
    ){
        revert("Not implemented");
    }
}