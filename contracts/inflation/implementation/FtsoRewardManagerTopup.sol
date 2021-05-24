// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { FtsoInflationAccounting } from "../../accounting/implementation/FtsoInflationAccounting.sol";
import { FtsoInflationAuthorizer } from "./FtsoInflationAuthorizer.sol";
import { FtsoRewardManager } from "../../ftso/implementation/FtsoRewardManager.sol";
import { IIWithdrawAmountProvider } from "../interface/IIWithdrawAmountProvider.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Ftso Reward Manager Topup
 * @notice This contract provides a formula to topup the FLR balance in the ftso reward manager contract.
 **/

contract FtsoRewardManagerTopup is IIWithdrawAmountProvider {
    using SafeMath for uint256;

    FtsoRewardManager public rewardManager;
    FtsoInflationAccounting public ftsoInflationAccounting;
    FtsoInflationAuthorizer public ftsoInflationAuthorizer;

    constructor(
        FtsoRewardManager _rewardManager, 
        FtsoInflationAccounting _ftsoInflationAccounting,
        FtsoInflationAuthorizer _ftsoInflationAuthorizer) {
        require(address(_rewardManager) != address(0), "reward manager zero");
        require(address(_ftsoInflationAccounting) != address(0), "inflation accounting zero");
        require(address(_ftsoInflationAuthorizer) != address(0), "inflation authorizer zero");
        rewardManager = _rewardManager;
        ftsoInflationAccounting = _ftsoInflationAccounting;
        ftsoInflationAuthorizer = _ftsoInflationAuthorizer;
    }

    /**
        For now, keep one-day's worth of funds (or so) on-hand or a maximum of the liability owed to the network.
        Something better should probably be devised that looks at unclaimed balance combined with withdrawal rates.
        The goal would be to minimize the amount kept on hand while minimizing the risk that not enough
        rewards will be available to handle claiming volume.
     */
    function getAmountTWei() external view override returns(uint256) {
        uint256 inflationToAllocateTWei;
        uint16 daysInAnnum;
        (inflationToAllocateTWei, daysInAnnum, , ,) = 
            ftsoInflationAuthorizer.inflationAnnums(ftsoInflationAuthorizer.currentAnnum());
        uint256 dailyRewardAmountTwei = inflationToAllocateTWei / daysInAnnum;
        uint256 unmintedInflation = ftsoInflationAccounting.getUnmintedInflationBalance();
        // Make the topup be the lesser of daily reward amount or unminted inflation.
        uint256 topup = 0;
        if (unmintedInflation < dailyRewardAmountTwei) {
            topup = unmintedInflation;
        } else {
            topup = dailyRewardAmountTwei;
        }
        uint256 currentBalance = address(rewardManager).balance;
        if (topup > currentBalance) {
            return topup.sub(currentBalance);
        } else {
            return 0;
        }
    }
}
