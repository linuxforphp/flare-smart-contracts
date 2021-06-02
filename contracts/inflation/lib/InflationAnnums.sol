// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { BokkyPooBahsDateTimeLibrary } from "../../utils/implementation/DateTimeLibrary.sol";
import { Inflation } from "../implementation/Inflation.sol";
import { InflationAnnum } from "./InflationAnnum.sol";
import { RewardServices } from "./RewardServices.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafePct } from "../../utils/implementation/SafePct.sol";
import { SharingPercentage } from "../interface/IIInflationSharingPercentageProvider.sol";

/**
 * @title Inflation Annums library
 * @notice A library to manage a collection of inflation annum and associated totals.
 **/
library InflationAnnums {    
    using BokkyPooBahsDateTimeLibrary for uint256;
    using InflationAnnum for InflationAnnum.InflationAnnumState;
    using RewardServices for RewardServices.RewardServicesState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `InflationAnnumsState` is state structure used by this library to manage
     *   a collection of inflation annums and associated totals.
     */
    struct InflationAnnumsState {
        // Collection of annums
        InflationAnnum.InflationAnnumState[] inflationAnnums;
        uint256 currentAnnum;
        // Balances
        uint256 totalRecognizedInflationWei;
        uint256 totalAuthorizedInflationWei;
        uint256 totalInflationTopupRequestedWei;
        uint256 totalInflationTopupReceivedWei;
        uint256 totalInflationTopupWithdrawnWei;
    }

    function authorizeDailyInflation(
        InflationAnnumsState storage _self,
        uint256 _periodsRemaining, 
        SharingPercentage[] memory _sharingPercentages
    ) 
        internal
        returns(uint256 _amountAuthorizedWei)
    {
        // Get the current annum
        InflationAnnum.InflationAnnumState storage currentAnnum = getCurrentAnnum(_self);
        // Authorize daily inflation for the current annum, across reward services, given
        // sharing percentages.
        _amountAuthorizedWei = currentAnnum.rewardServices.authorizeDailyInflation(
            _self.totalRecognizedInflationWei,
            _self.totalAuthorizedInflationWei, 
            _periodsRemaining, 
            _sharingPercentages);
        // Accumulate total authorized inflation across all annums
        _self.totalAuthorizedInflationWei = _self.totalAuthorizedInflationWei.add(_amountAuthorizedWei);
    }

    function computeTopupRequest(
        InflationAnnumsState storage _self,
        Inflation _inflation
    )
        internal
        returns(uint256 _topupRequestWei)
    {
        // Get the current annum
        InflationAnnum.InflationAnnumState storage currentAnnum = getCurrentAnnum(_self);
        // Compute the topup
        _topupRequestWei = currentAnnum.rewardServices.computeTopupRequest(_inflation);
        _self.totalInflationTopupRequestedWei = _self.totalInflationTopupRequestedWei.add(_topupRequestWei);
    }

    function receiveTopupRequest(
        InflationAnnumsState storage _self
    )
        internal
        returns(uint256 _amountPostedWei)
    {
        // Get the current annum
        InflationAnnum.InflationAnnumState storage currentAnnum = getCurrentAnnum(_self);

        // Receive minting of topup request. Post to received and withdrawn buckets for each reward service.
        _amountPostedWei = currentAnnum.rewardServices.receiveTopupRequest();
        // Post the amount of FLR received into the Inflation contract
        _self.totalInflationTopupReceivedWei = _self.totalInflationTopupReceivedWei.add(_amountPostedWei);
        // Post amount withdrawn and transferred to reward service contracts
        _self.totalInflationTopupWithdrawnWei = _self.totalInflationTopupWithdrawnWei.add(_amountPostedWei);
    }

    function getCount(InflationAnnumsState storage _self) internal view returns(uint256) {
        return _self.inflationAnnums.length;
    }

    function getCurrentAnnum(
        InflationAnnumsState storage _self
    )
        internal view 
        returns (InflationAnnum.InflationAnnumState storage _inflationAnnum)
    {
        require(getCount(_self) > 0, "no annum");
        _inflationAnnum = _self.inflationAnnums[_self.currentAnnum];
    }

    function initializeNewAnnum(
        InflationAnnumsState storage _self,
        uint256 _startTimeStamp, 
        uint256 _inflatableBalance, 
        uint256 _annualInflationPercentageBips
    ) 
        internal
    {
        // Create an empty annum
        InflationAnnum.InflationAnnumState storage inflationAnnum = _self.inflationAnnums.push();
        // Initialize it with newly passed in annum info
        inflationAnnum.initialize(_startTimeStamp, _inflatableBalance, _annualInflationPercentageBips);
        // Accumulate total recognized inflation across annums 
        _self.totalRecognizedInflationWei = 
            _self.totalRecognizedInflationWei.add(inflationAnnum.recognizedInflationWei);
        // Reposition index pointing to current annum
        if (_self.inflationAnnums.length > 1) {
            _self.currentAnnum = _self.currentAnnum.add(1);
        }
        // TODO: Fire event
    }
}