// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { BokkyPooBahsDateTimeLibrary } from "../../utils/implementation/DateTimeLibrary.sol";
import { RewardServices } from "./RewardServices.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafePct } from "../../utils/implementation/SafePct.sol";

/**
 * @title Inflation Annum library
 * @notice A library to manage an inflation annum. 
 **/
library InflationAnnum {    
    using BokkyPooBahsDateTimeLibrary for uint256;
    using InflationAnnum for InflationAnnum.InflationAnnumState;
    using SafeCast for uint256;
    using SafePct for uint256;

    /**
     * @dev `InflationAnnumState` is state structure used by this library to manage
     *   an inflation annum.
     */
    struct InflationAnnumState {
        uint256 recognizedInflationWei;
        uint16 daysInAnnum;
        uint256 startTimeStamp;
        uint256 endTimeStamp;
        RewardServices.RewardServicesState rewardServices;
    }

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points

    function _computeRecognizedInflationWei(
        uint256 _inflatableBalance, 
        uint256 _annualInflationPercentageBips
    ) 
        internal pure
        returns(uint256)
    {
        return _inflatableBalance.mulDiv(
            _annualInflationPercentageBips, 
            BIPS100);
    }

    function _computeDaysRemainingInAnnum(
        InflationAnnumState storage _self, 
        uint256 _atTimeStamp
    )
        internal view
        returns(uint256)
    {
        uint256 endTimeStamp = _self.endTimeStamp;
        if (_atTimeStamp > endTimeStamp) {
            return 0;
        } else {
            return _atTimeStamp.diffDays(endTimeStamp);
        }
    }

    function _getAnnumEndsTs(uint256 _startTimeStamp) internal pure returns (uint256) {
        uint256 nextYearTimeStamp = _startTimeStamp.addYears(1);
        if (_startTimeStamp.getMonth() == 2 && _startTimeStamp.getDay() == 29) {
            nextYearTimeStamp = nextYearTimeStamp.addDays(1);
        }
        return nextYearTimeStamp.subSeconds(1);
    }

    function _computeDaysInAnnum(uint256 _startTimeStamp, uint256 _endTimeStamp) internal pure returns(uint16) {
        return _startTimeStamp.diffDays(_endTimeStamp.addSeconds(1)).toUint16();
    }

    function initialize(
        InflationAnnumState storage _self,
        uint256 _startTimeStamp, 
        uint256 _inflatableBalance, 
        uint256 _annualInflationPercentageBips
    ) 
        internal
    {
        _self.startTimeStamp = _startTimeStamp;
        _self.recognizedInflationWei = _computeRecognizedInflationWei(
            _inflatableBalance, 
            _annualInflationPercentageBips);
        _self.endTimeStamp = _getAnnumEndsTs(_startTimeStamp);
        _self.daysInAnnum = _computeDaysInAnnum(_startTimeStamp,_self.endTimeStamp);
    }
}