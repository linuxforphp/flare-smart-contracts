// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { BokkyPooBahsDateTimeLibrary } from "../../utils/implementation/DateTimeLibrary.sol";
import { Governed } from "../../governance/implementation/Governed.sol";
import { FlareKeeper } from "../../utils/implementation/FlareKeeper.sol";
import { IFlareKeep } from "../../utils/interfaces/IFlareKeep.sol";
import { InflationAnnum } from "../lib/InflationAnnum.sol";
import { InflationAnnums } from "../lib/InflationAnnums.sol";
import { IIInflationPercentageProvider } from "../interface/IIInflationPercentageProvider.sol";
import { IIInflationReceiver } from "../interface/IIInflationReceiver.sol";
import { IIInflationSharingPercentageProvider } from "../interface/IIInflationSharingPercentageProvider.sol";
import { TopupConfiguration, TopupType } from "../lib/RewardService.sol"; 
import { Supply } from "../../accounting/implementation/Supply.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafePct } from "../../utils/implementation/SafePct.sol";

//import "hardhat/console.sol";

contract Inflation is Governed, IFlareKeep {
    using InflationAnnums for InflationAnnums.InflationAnnumsState;
    using SafeMath for uint256;
    using SafePct for uint256;
    using BokkyPooBahsDateTimeLibrary for uint256;

    // Composable contracts
    IIInflationPercentageProvider public inflationPercentageProvider;
    IIInflationSharingPercentageProvider public inflationSharingPercentageProvider;
    FlareKeeper public flareKeeper;
    Supply public supply;

    // The annums
    InflationAnnums.InflationAnnumsState private inflationAnnums;       // Inflation annum data

    // Instance vars
    uint256 public lastAuthorizationTs;                                 // The last time inflation was authorized
    mapping(IIInflationReceiver => TopupConfiguration)
        internal topupConfigurations;                                   // A topup configuration for a contract
                                                                        //   receiving inflation.
    uint256 public totalSelfDestructReceivedWei;
    uint256 public totalSelfDestructWithdrawnWei;
    uint256 immutable public rewardEpochStartTs;
    uint256 public rewardEpochStartedTs;

    // Constants
    string internal constant ERR_IS_ZERO = "address is 0";
    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_TOPUP_LOW = "topup low";

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points
    uint256 internal constant DEFAULT_TOPUP_FACTOR_X100 = 120;
    uint256 internal constant AUTHORIZE_TIME_FRAME_SEC = 1 days;

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        require (getExpectedBalance() == address(this).balance, ERR_OUT_OF_BALANCE);
    }

    modifier notZero(address _address) {
        require(_address != address(0), ERR_IS_ZERO);
        _;
    }

    constructor (
        address _governance, 
        IIInflationPercentageProvider _inflationPercentageProvider,
        IIInflationSharingPercentageProvider _inflationSharingPercentageProvider,
        FlareKeeper _flareKeeper,
        uint256 _rewardEpochStartTs
    )
        Governed(_governance)
        notZero(address(_inflationPercentageProvider))
        notZero(address(_inflationSharingPercentageProvider))
        notZero(address(_flareKeeper))
    {
        inflationPercentageProvider = _inflationPercentageProvider;
        inflationSharingPercentageProvider = _inflationSharingPercentageProvider;
        flareKeeper = _flareKeeper;
        rewardEpochStartTs = _rewardEpochStartTs;
    }

    function getTotalAuthorizedInflationWei() external view returns(uint256) {
        return inflationAnnums.totalAuthorizedInflationWei;
    }

    function getTotalInflationTopupRequestedWei() external view returns(uint256) {
        return inflationAnnums.totalInflationTopupRequestedWei;
    }

    function getTotalInflationTopupReceivedWei() external view returns(uint256) {
        return inflationAnnums.totalInflationTopupReceivedWei;
    }

    function getTotalInflationTopupWithdrawnWei() external view returns(uint256) {
        return inflationAnnums.totalInflationTopupWithdrawnWei;
    }

    function getTotalRecognizedInflationWei() external view returns(uint256) {
        return inflationAnnums.totalRecognizedInflationWei;
    }

    function getCurrentAnnum() external view returns(InflationAnnum.InflationAnnumState memory) {
        return inflationAnnums.getCurrentAnnum();
    }

    function receiveMinting() external payable mustBalance {
        uint256 amountPostedWei = inflationAnnums.receiveTopupRequest();
        // Assume that if we got more than we posted, we must have been a self-destruct
        // recipient in this block.
        uint256 selfDestructProceeds = msg.value.sub(amountPostedWei);
        totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(selfDestructProceeds);
    }

    function setInflationPercentageProvider(
        IIInflationPercentageProvider _inflationPercentageProvider
    )
        external
        notZero(address(_inflationPercentageProvider))
        onlyGovernance
    {
        inflationPercentageProvider = _inflationPercentageProvider;
    }

    function setInflationSharingPercentageProvider(
        IIInflationSharingPercentageProvider _inflationSharingPercentageProvider
    )
        external
        notZero(address(_inflationSharingPercentageProvider))
        onlyGovernance
    {
        inflationSharingPercentageProvider = _inflationSharingPercentageProvider;
    }

    function setFlareKeeper(FlareKeeper _flareKeeper) external notZero(address(_flareKeeper)) onlyGovernance {
        flareKeeper = _flareKeeper;
    }

    function setSupply(Supply _supply) external notZero(address(_supply)) onlyGovernance {
        supply = _supply;
    }

    // Sets the topup configuration for a reward service target
    function setTopupConfiguration(
        IIInflationReceiver _inflationReceiver, 
        TopupType _topupType, 
        uint256 _topupFactorX100
    )
        external
        notZero(address(_inflationReceiver))
        onlyGovernance
    {
        if (_topupType == TopupType.FACTOROFDAILYAUTHORIZED) {
            require(_topupFactorX100 > 100, ERR_TOPUP_LOW);
        }
        TopupConfiguration storage topupConfiguration = topupConfigurations[_inflationReceiver];
        topupConfiguration.topupType = _topupType;
        topupConfiguration.topupFactorX100 = _topupFactorX100;
        topupConfiguration.configured = true;
    }

    function getTopupConfiguration(
        IIInflationReceiver _inflationReceiver
    )
        public
        notZero(address(_inflationReceiver))
        returns(TopupConfiguration memory _topupConfiguration)
    {
        TopupConfiguration storage topupConfiguration = topupConfigurations[_inflationReceiver];
        if (!topupConfiguration.configured) {
            topupConfiguration.topupType = TopupType.FACTOROFDAILYAUTHORIZED;
            topupConfiguration.topupFactorX100 = DEFAULT_TOPUP_FACTOR_X100;
            topupConfiguration.configured = true;
        }
        _topupConfiguration.topupType = topupConfiguration.topupType;
        _topupConfiguration.topupFactorX100 = topupConfiguration.topupFactorX100;
        _topupConfiguration.configured = topupConfiguration.configured;
    }

    function keep() public virtual override notZero(address(supply)) returns(bool) {
        // If inflation rewarding not started yet, blow off processing until it does.
        if (block.timestamp < rewardEpochStartTs) {
            return true;
        }

        // If inflation rewarding started and we have not updated when it started, do so now.
        if (rewardEpochStartedTs == 0) {
            rewardEpochStartedTs = block.timestamp;
        }

        // Is it time to recognize new inflation annum?
        if (inflationAnnums.getCount() == 0 || block.timestamp > inflationAnnums.getCurrentAnnum().endTimeStamp) {
            inflationAnnums.initializeNewAnnum(
                block.timestamp, 
                supply.getInflatableBalance(), 
                inflationPercentageProvider.getAnnualPercentageBips()
            );
        }

        // Is it time to authorize new inflation? Do it daily.
        if (lastAuthorizationTs.add(AUTHORIZE_TIME_FRAME_SEC) < block.timestamp) {

            // Update time we last authorized.
            lastAuthorizationTs = block.timestamp;
            
            // Authorize for periods remaining in current annum, for current sharing percentges.
            // Add 1 to the periods remaining because the difference between days does not count the current day.
            uint256 amountAuthorizedWei = inflationAnnums.authorizeDailyInflation(
                block.timestamp.diffDays(inflationAnnums.getCurrentAnnum().endTimeStamp).add(1),
                inflationSharingPercentageProvider.getSharingPercentages()
            );

            // Add the inflation to the supply contract to keep inflatable balance updated.
            supply.addAuthorizedInflation(amountAuthorizedWei);

            // Time to compute topup amount for inflation receivers.
            uint256 topupRequestWei = inflationAnnums.computeTopupRequest(this);

            // Send mint request to the keeper.
            flareKeeper.requestMinting(topupRequestWei);
        }
        return true;
    }

    function getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        return inflationAnnums.totalInflationTopupReceivedWei        
            .sub(inflationAnnums.totalInflationTopupWithdrawnWei)
            .add(totalSelfDestructReceivedWei)
            .sub(totalSelfDestructWithdrawnWei);
    }
}
