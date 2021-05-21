// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { FlareKeeper } from "../../implementations/FlareKeeper.sol";
import { Governed } from "../../governance/implementation/Governed.sol";
import { IFlareKeep } from "../../interfaces/IFlareKeep.sol";
import { IIWithdrawAmountProvider } from "../interface/IIWithdrawAmountProvider.sol";
import { MintAccounting } from "../../accounting/implementation/MintAccounting.sol";

/**
 * @title Minting Faucet
 * @notice This abstract contract handles the mint requesting and transference to reward contracts
 *   of FLR inflation rewards. An implementation provides specific calls to the correct accounting
 *   methods for a particular type of inflation reward.
 **/

abstract contract MintingFaucet is Governed, IFlareKeep {
    FlareKeeper public flareKeeper;
    IIWithdrawAmountProvider public withdrawAmountProvider;
    address public rewardManager;
    MintAccounting public mintAccounting;
    uint256 public lastFundsWithdrawTs;
    uint256 public fundWithdrawTimeLockSec;
    uint256 public fundRequestIntervalSec;
    bool private requested;
    uint256 public nextWithdrawAmountTWei;

    event RewardContractUpdated (address from, address to);
    event FlareKeeperUpdated (address from, address to);
    event MintingRequested(uint256 timeStamp, uint256 amount);
    event RewardFundsWithdrawn(uint256 timeStamp, uint256 amount);

    constructor(
        address _governance,
        IIWithdrawAmountProvider _withdrawAmountProvider, 
        address _rewardManager, 
        FlareKeeper _flareKeeper, 
        uint256 _fundWithdrawTimeLockSec,
        uint256 _fundRequestIntervalSec,
        MintAccounting _mintAccounting) Governed(_governance) {
        lastFundsWithdrawTs = block.timestamp;
        requested = false;
        withdrawAmountProvider = _withdrawAmountProvider;
        rewardManager = _rewardManager;
        fundWithdrawTimeLockSec = _fundWithdrawTimeLockSec;
        flareKeeper = _flareKeeper;
        fundRequestIntervalSec = _fundRequestIntervalSec;
        mintAccounting = _mintAccounting;
    }

    function setRewardContract(address _rewardManager) external onlyGovernance {
        emit RewardContractUpdated(_rewardManager, rewardManager);
        rewardManager = _rewardManager;
    }

    function setFlareKeeper(FlareKeeper _flareKeeper) external onlyGovernance {
        emit FlareKeeperUpdated(address(_flareKeeper), address(flareKeeper));
        flareKeeper = _flareKeeper;
    }

    // TODO: Setters for other dependencies that might need changability (accounting contracts, etc)

    function keep() external override returns(bool) {
        requestMinting();
        withdrawRewardFunds();
        return true;
    }

    // Queue up minting request for the keeper
    function requestMinting() internal {
        if (lastFundsWithdrawTs + fundWithdrawTimeLockSec - fundRequestIntervalSec < block.timestamp && !requested) {
            // can request funds
            requested = true;
            nextWithdrawAmountTWei = withdrawAmountProvider.getAmountTWei();
            mintAccounting.requestMinting(nextWithdrawAmountTWei);
            emit MintingRequested(block.timestamp, nextWithdrawAmountTWei);
        }
    }

    // Send funds from the keeper to which ever reward manager was requesting and do the accounting
    function withdrawRewardFunds() internal {
        if (lastFundsWithdrawTs + fundWithdrawTimeLockSec < block.timestamp) {
            // can send funds
            lastFundsWithdrawTs = block.timestamp;  // Set state before transfer to avoid re-entrancy problems
            requested = false;
            // call keeper instead
            withdrawRewardFundsCallback(nextWithdrawAmountTWei);
            flareKeeper.transferTo(rewardManager, nextWithdrawAmountTWei);
            emit RewardFundsWithdrawn(block.timestamp, nextWithdrawAmountTWei);
        }
    }

    function withdrawRewardFundsCallback(uint _amountTWei) internal virtual {}
}