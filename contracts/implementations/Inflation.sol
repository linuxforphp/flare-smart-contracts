// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./Governed.sol";
import "../interfaces/IFlareKeep.sol";
import "../interfaces/IInflation.sol";
import "../interfaces/IRewardManager.sol";


contract Inflation is IInflation, Governed, IFlareKeep {

    struct AnnumData {
        uint256 initialSupplyWei;
        uint256 totalInflationWei;
        uint256 startTimeStamp;
    }

    ///annual data
    uint256 constant public ANNUAL_INFLATION_PERCENT = 10;
    AnnumData[] public flareAnnumData;
    uint256 public currentFlareAnnum; // Flare year

    /// fund withdrawls by reward contract
    uint256 public lastFundsWithdrawTs;
    uint256 public dailyWithdrawAmountTwei; // withdraw daily limit
    uint256 public fundWithdrawTimeLockSec;

    IRewardManager public rewardManager;

    event RewardContractUpdated (IRewardManager newContract, IRewardManager oldContract);

    constructor(
        address _governance,
        uint256 _fundWithdrawTimeLockSec,
        uint256 totalFlrSupply
    ) 
        Governed(_governance)
    {
        fundWithdrawTimeLockSec = _fundWithdrawTimeLockSec;

        AnnumData memory newAnum = AnnumData({
            initialSupplyWei: totalFlrSupply,
            totalInflationWei: totalFlrSupply * ANNUAL_INFLATION_PERCENT / 100,
            startTimeStamp: block.timestamp
        });

        flareAnnumData.push(newAnum);
    }

    function setRewardContract(IRewardManager _rewardManager) external override onlyGovernance {

        emit RewardContractUpdated(rewardManager, _rewardManager);
        rewardManager = _rewardManager;

        // TODO: Bug. Fix.
        rewardManager.setDailyRewardAmount(
            flareAnnumData[flareAnnumData.length - 1].totalInflationWei / 356
        );
    }

    function keep() external override {
        if (currentAnnumEndsTs() < block.timestamp) {
            initNewAnnum();
        }
    }

    function withdrawRewardFunds() external override returns (uint256 nextWithdrawTimestamp) {

        if (lastFundsWithdrawTs + fundWithdrawTimeLockSec < block.timestamp) {
            // can send funds
            lastFundsWithdrawTs = block.timestamp;  // Set state before transfer to avoid re-entrancy problems
            // TODO: move to WFLR?
            (payable(address(rewardManager))).transfer(dailyWithdrawAmountTwei);
        }

        emit WithDrawRewardFunds(block.timestamp, dailyWithdrawAmountTwei);

        return lastFundsWithdrawTs + fundWithdrawTimeLockSec;
    }

    function currentAnnumEndsTs() public view returns (uint256 endTs) {
        // TODO: So broken - leap years not accounted for. Days do not convert to seconds.
        // And number of days is wrong.
        endTs = flareAnnumData[currentFlareAnnum].startTimeStamp + (1 days * 356);
    }

    function initNewAnnum() internal {
        currentFlareAnnum++;

        //TODO: account for token burns?
        uint256 initialSupplyWei = 
                flareAnnumData[currentFlareAnnum].initialSupplyWei + 
                flareAnnumData[currentFlareAnnum].totalInflationWei;

        AnnumData memory newAnum = AnnumData({
            initialSupplyWei: initialSupplyWei,
            totalInflationWei: initialSupplyWei * ANNUAL_INFLATION_PERCENT / 100,
            startTimeStamp: block.timestamp
        });

        // TODO: Broken again. Fix. 
        dailyWithdrawAmountTwei = newAnum.totalInflationWei * 2 / 356; // 2 days worth of funds
        rewardManager.setDailyRewardAmount(newAnum.totalInflationWei / 356);
    }
}
