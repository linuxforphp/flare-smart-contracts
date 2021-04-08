// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./Governed.sol";
import "../interfaces/IFlareKeep.sol";
import "../interfaces/IInflation.sol";
import "../interfaces/IRewardManager.sol";
import "../lib/DateTimeLibrary.sol";

import "hardhat/console.sol";

contract Inflation is IInflation, Governed, IFlareKeep {
    using BokkyPooBahsDateTimeLibrary for uint256;

    struct AnnumData {
        uint256 initialSupplyWei;
        uint256 totalInflationWei;
        uint256 startTimeStamp;
    }

    ///annual data
    // TODO: Make settable by governance?
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

        AnnumData memory newAnnum = AnnumData({
            initialSupplyWei: totalFlrSupply,
            totalInflationWei: totalFlrSupply * ANNUAL_INFLATION_PERCENT / 100,
            startTimeStamp: block.timestamp
        });

        dailyWithdrawAmountTwei = newAnnum.totalInflationWei * 2 / 
            newAnnum.startTimeStamp.getDaysInYear(); // 2 days worth of funds

        flareAnnumData.push(newAnnum);
    }

    function setRewardContract(IRewardManager _rewardManager) external override onlyGovernance {

        emit RewardContractUpdated(rewardManager, _rewardManager);
        rewardManager = _rewardManager;

        rewardManager.setDailyRewardAmount(
            flareAnnumData[currentFlareAnnum].totalInflationWei / 
                flareAnnumData[currentFlareAnnum].startTimeStamp.getDaysInYear()
        );
    }

    function keep() external override returns(bool) {
        if (currentAnnumEndsTs() < block.timestamp) {
            initNewAnnum();
        }
        return true;
    }

    // TODO: Who is supposed to call this function? Why wouldn't keeper, or is this to be a pull from RM?
    // TODO: Why not protected with onlyGovernance?
    function withdrawRewardFunds() external override returns (uint256 nextWithdrawTimestamp) {
        // TODO: Should this not keep the amount withdrawn?
        // TODO: Should this also validate amount withdrawn does not exceed annual inflation amount?
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
        endTs = flareAnnumData[currentFlareAnnum].startTimeStamp.addYears(1).subSeconds(1);
    }

    function initNewAnnum() internal {
        //TODO: account for token burns?
        uint256 initialSupplyWei = 
                flareAnnumData[currentFlareAnnum].initialSupplyWei + 
                flareAnnumData[currentFlareAnnum].totalInflationWei;

        AnnumData memory newAnnum = AnnumData({
            initialSupplyWei: initialSupplyWei,
            totalInflationWei: initialSupplyWei * ANNUAL_INFLATION_PERCENT / 100,
            startTimeStamp: block.timestamp
        });

        flareAnnumData.push(newAnnum);

        currentFlareAnnum++;

        uint256 daysInYear = newAnnum.startTimeStamp.getDaysInYear();

        dailyWithdrawAmountTwei = newAnnum.totalInflationWei * 2 / daysInYear; // 2 days worth of funds
        rewardManager.setDailyRewardAmount(newAnnum.totalInflationWei / daysInYear);
    }
}
