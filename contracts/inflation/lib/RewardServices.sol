// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { BokkyPooBahsDateTimeLibrary } from "../../utils/implementation/DateTimeLibrary.sol";
import { Inflation } from "../implementation/Inflation.sol";
import { IIInflationReceiver } from "../interface/IIInflationReceiver.sol";
import { RewardService } from "./RewardService.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafePct } from "../../utils/implementation/SafePct.sol";
import { SharingPercentage } from "../interface/IIInflationSharingPercentageProvider.sol";
import { TopupConfiguration } from "./RewardService.sol";

/**
 * @title Reward Services library
 * @notice A library to manage a collection of reward services and associated totals and perform operations
 *   that impact or involve the collection, such as allocating new authorized inflation amounts.
 **/
library RewardServices {    
    using BokkyPooBahsDateTimeLibrary for uint256;
    using RewardService for RewardService.RewardServiceState;
    using SafeMath for uint256;
    using SafePct for uint256;

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points

    /**
     * @dev `RewardServicesState` is state structure used by this library to manage
     *   a collection of reward services and associated totals.
     */
    struct RewardServicesState {
        // Collection of annums
        RewardService.RewardServiceState[] rewardServices;
        // Balances
        uint256 totalAuthorizedInflationWei;
        uint256 totalInflationTopupRequestedWei;
        uint256 totalInflationTopupReceivedWei;
        uint256 totalInflationTopupWithdrawnWei;
    }

    function authorizeDailyInflation(
        RewardServicesState storage _self,
        uint256 _totalRecognizedInflationWei,
        uint256 _totalAuthorizedInflationWei,
        uint256 _periodsRemaining,
        SharingPercentage[] memory sharingPercentages
    )
        internal
        returns(uint256 _amountAuthorizedWei)
    {
        // If there are no sharing percentages, then there is nothing to authorize.
        if (sharingPercentages.length == 0) {
            _amountAuthorizedWei = 0;
            return _amountAuthorizedWei;
        }
        
        // Compute amount to allocate
        uint256 amountToAuthorizeRemaingWei = _totalRecognizedInflationWei
            .sub(_totalAuthorizedInflationWei)
            .div(_periodsRemaining);
        // Set up return value with amount authorized
        _amountAuthorizedWei = amountToAuthorizeRemaingWei;
        // Accumulate authorized total...note that this total is for a given annum
        _self.totalAuthorizedInflationWei = _self.totalAuthorizedInflationWei.add(amountToAuthorizeRemaingWei);
        // Start with total bips in denominator
        uint256 divisorRemaining = BIPS100;
        // Loop over sharing percentages
        for(uint256 i; i < sharingPercentages.length; i++) {
            // Compute the amount to authorize for a given service
            uint256 toAuthorizeWei = amountToAuthorizeRemaingWei.mulDiv(
                sharingPercentages[i].percentBips, 
                divisorRemaining
            );
            // Reduce the numerator by amount just computed
            amountToAuthorizeRemaingWei = amountToAuthorizeRemaingWei.sub(toAuthorizeWei);
            // Reduce the divisor by the bips just allocated
            divisorRemaining = divisorRemaining.sub(sharingPercentages[i].percentBips);
            // Try to find a matching reward service for the given sharing percentage.
            // New sharing percentages can be added at any time. And if one gets removed,  
            // we don't remove that reward service for a given annum, since its total still
            // remains applicable.
            ( bool found, uint256 rewardServiceIndex ) = 
                findRewardService(_self, sharingPercentages[i].inflationReceiver);
            if (found) {
                // Get the existing reward service
                RewardService.RewardServiceState storage rewardService = _self.rewardServices[rewardServiceIndex];
                // Accumulate the amount authorized for the service
                rewardService.addAuthorizedInflation(toAuthorizeWei);
            } else {
                // Initialize a new reward service
                RewardService.RewardServiceState storage rewardService = _self.rewardServices.push();
                rewardService.initialize(sharingPercentages[i].inflationReceiver);
                // Accumulate the amount authorized for the service
                rewardService.addAuthorizedInflation(toAuthorizeWei);                
            }                
            // Signal the inflation receiver of the reward service (the actual rewarding contract)
            // with amount just authorized.
            sharingPercentages[i].inflationReceiver.setDailyAuthorizedInflation(toAuthorizeWei);
            // TODO: Fire event
        }
    }

    function computeTopupRequest(
        RewardServicesState storage _self,
        Inflation _inflation
    )
        internal
        returns (uint256 _topupRequestWei)
    {
        for(uint256 i; i < _self.rewardServices.length; i++) {
            TopupConfiguration memory topupConfiguration = 
                _inflation.getTopupConfiguration(_self.rewardServices[i].inflationReceiver);
            _topupRequestWei = _topupRequestWei.add(_self.rewardServices[i].computeTopupRequest(topupConfiguration));
        }
        _self.totalInflationTopupRequestedWei = _self.totalInflationTopupRequestedWei.add(_topupRequestWei);
    }

    function findRewardService(
        RewardServicesState storage _self,
        IIInflationReceiver _inflationReceiver
    ) 
        internal view
        returns(bool _found, uint256 _index)
    {
        // The number of these is expected to be low.
        _found = false;
        for(uint256 i; i < _self.rewardServices.length; i++) {
            if (address(_self.rewardServices[i].inflationReceiver) == address(_inflationReceiver)) {
                _index = i;
                _found = true;
                break;
            }
        }
    }

    // Assume value is siting in Inflation contract waiting to be posted and transmitted.
    // This function is atomic, so if for some reason not enough FLR got minted, this
    // function will fail until all topup requests can be satisfied.
    function receiveTopupRequest(
        RewardServicesState storage _self
    ) 
        internal 
        returns(uint256 _amountPostedWei)
    {
        // Spin through all reward services
        for(uint256 i; i < _self.rewardServices.length; i++) {
            // Get the pending topup for the service
            uint256 pendingTopupWei = _self.rewardServices[i].getPendingTopup();
            // Accumulate topup received
            _self.rewardServices[i].addTopupReceived(pendingTopupWei);
            _self.totalInflationTopupReceivedWei = _self.totalInflationTopupReceivedWei.add(pendingTopupWei);
            // Transfer topup to rewarding service contract
            _self.rewardServices[i].inflationReceiver.receiveInflation{ value: pendingTopupWei }();
            // Accumulate topup withdrawn
            _self.rewardServices[i].addTopupWithdrawn(pendingTopupWei);
            _self.totalInflationTopupWithdrawnWei = _self.totalInflationTopupWithdrawnWei.add(pendingTopupWei);
            // Accumulate amount posted
            _amountPostedWei = _amountPostedWei.add(pendingTopupWei);
            // TODO: Fire events
        }
    }
}