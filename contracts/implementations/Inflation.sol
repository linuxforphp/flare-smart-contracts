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
    uint256 public fundWithdrawTimeLockMs;

    IRewardContract public rewardManager;

    event RewardContractUpdated (IRewardContract newContract, IRewardContract oldContract);

    constructor(
        address _governance,
        uint256 _fundWithdrawTimeLockMs,
        uint256 totalFlrSupply
    ) 
        Governed(_governance)
    {
        fundWithdrawTimeLockMs = _fundWithdrawTimeLockMs;

        AnnumData memory newAnum = AnnumData({
            initialSupplyWei: totalFlrSupply,
            totalInflationWei: totalFlrSupply * ANNUAL_INFLATION_PERCENT / 100,
            startTimeStamp: block.timestamp
        });

        flareAnnumData.push(newAnum);
    }

    function setRewardContract(IRewardContract _rewardManager) external override onlyGovernance {

        emit RewardContractUpdated(rewardManager, _rewardManager);
        rewardManager = _rewardManager;

        rewardManager.setDailyRewardAmount(
            flareAnnumData[flareAnnumData.length - 1].totalInflationWei / 356
        );
    }

    function keep() external override {
        if (currentAnnumEndsTs() < block.timestamp) {
            initNewAnnum();
        }
    }

    function currentAnnumEndsTs() public view returns (uint256 endTs) {
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

        dailyWithdrawAmountTwei = newAnum.totalInflationWei * 2 / 356; // 2 days worth of funds
        rewardManager.setDailyRewardAmount(newAnum.totalInflationWei / 356);
    }

    function withdrawRewardFunds() external override returns (uint256 nextWithdrawTimestamp) {

        if (lastFundsWithdrawTs + fundWithdrawTimeLockMs < block.timestamp) {
            // can send funds
            // TODO: move to WFLR?
            (payable(address(rewardManager))).transfer(dailyWithdrawAmountTwei);
            lastFundsWithdrawTs = block.timestamp;
        }

        emit WithDrawRewardFunds(block.timestamp, dailyWithdrawAmountTwei);

        return lastFundsWithdrawTs + fundWithdrawTimeLockMs;
    }
}
