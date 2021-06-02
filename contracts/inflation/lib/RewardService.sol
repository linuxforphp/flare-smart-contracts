// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { IIInflationReceiver } from "../interface/IIInflationReceiver.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafePct } from "../../utils/implementation/SafePct.sol";

//import "hardhat/console.sol";

enum TopupType{ FACTOROFDAILYAUTHORIZED, ALLAUTHORIZED }

struct TopupConfiguration {
    TopupType topupType;                            // Topup algo type
    uint256 topupFactorX100;                        // Topup factor, times 100, if applicable for type
    bool configured;                                // Flag to indicate whether initially configured
}

/**
 * @title Reward Service library
 * @notice A library representing rewardable service that shares distributing the annual inflation rewards. 
 **/
library RewardService {    
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `RewardServiceState` is state structure used by this library to manage
     *   an a reward service tracking authorize inflation.
     */
    struct RewardServiceState {
        IIInflationReceiver inflationReceiver;          // The target rewarding contract
        uint256 authorizedInflationWei;                 // Total authorized inflation for this reward service
        uint256 lastDailyAuthorizedInflationWei;        // Last daily authorized inflation amount
        uint256 inflationTopupRequestedWei;             // Total inflation topup requested to be minted
        uint256 inflationTopupReceivedWei;              // Total inflation minting received
        uint256 inflationTopupWithdrawnWei;             // Total inflation minting sent to rewarding service contract
    }

    function addAuthorizedInflation(RewardServiceState storage _self, uint256 _amountWei) internal {
        _self.authorizedInflationWei = _self.authorizedInflationWei.add(_amountWei);
        _self.lastDailyAuthorizedInflationWei = _amountWei;
    }

    function addTopupReceived(RewardServiceState storage _self, uint256 _amountWei) internal {
        _self.inflationTopupReceivedWei = _self.inflationTopupReceivedWei.add(_amountWei);
    }

    function addTopupWithdrawn(RewardServiceState storage _self, uint256 _amountWei) internal {
        _self.inflationTopupWithdrawnWei = _self.inflationTopupWithdrawnWei.add(_amountWei);
    }

    function computeTopupRequest(
        RewardServiceState storage _self,
        TopupConfiguration memory _topupConfiguration
    )
        internal 
        returns (uint256 _topupRequestWei)
    {
        // Get the balance of the inflation receiver
        uint256 _inflationReceiverBalanceWei = address(_self.inflationReceiver).balance;
        if (_topupConfiguration.topupType == TopupType.FACTOROFDAILYAUTHORIZED) {
            // Compute a topup request based purely on the given factor, the last daily authorization, and
            // the balance that is sitting in the reward service contract.
            uint256 rawTopupRequestWei = _self.lastDailyAuthorizedInflationWei
                .mulDiv(_topupConfiguration.topupFactorX100, 100)
                .sub(_inflationReceiverBalanceWei);
            // Compute what is already pending to be topped up
            uint256 topupPendingWei = getPendingTopup(_self);
            // If what is pending to topup is greater than the raw request, request no more.
            if (topupPendingWei > rawTopupRequestWei) {
                _topupRequestWei = 0;
            } else {
                // Back out any request that is already pending
                _topupRequestWei = rawTopupRequestWei.sub(topupPendingWei);
            }
            // And finally, in any case, topup requested cannot be more than the net of 
            // authorized, pending, and received
            uint256 maxTopupRequestWei = _self.authorizedInflationWei
                .sub(topupPendingWei)
                .sub(_self.inflationTopupReceivedWei);
            if (_topupRequestWei > maxTopupRequestWei) {
                _topupRequestWei = maxTopupRequestWei;
            }
        } else if (_topupConfiguration.topupType == TopupType.ALLAUTHORIZED) {
            _topupRequestWei = _self.authorizedInflationWei
                .sub(_self.inflationTopupRequestedWei);
        } else { // This code is unreachable since TopupType currently has only 2 constructors
            _topupRequestWei = 0;
            assert(false);
        }
        _self.inflationTopupRequestedWei = _self.inflationTopupRequestedWei.add(_topupRequestWei);
        // TODO: Fire event
    }

    function getPendingTopup(
        RewardServiceState storage _self
    )
        internal view
        returns(uint256 _pendingTopupWei)
    {
        return _self.inflationTopupRequestedWei.sub(_self.inflationTopupReceivedWei);        
    }

    function initialize(
        RewardServiceState storage _self,
        IIInflationReceiver _inflationReceiver
    ) 
        internal
    {
        _self.inflationReceiver = _inflationReceiver;
    }
}