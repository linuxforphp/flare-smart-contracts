// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { BokkyPooBahsDateTimeLibrary } from "../../utils/implementation/DateTimeLibrary.sol";
import { CloseManager } from "../../accounting/implementation/CloseManager.sol";
import { Governed } from "../../governance/implementation/Governed.sol";
import { IFlareKeep } from "../../utils/interfaces/IFlareKeep.sol";
import { IIInflationPercentageProvider } from "../interface/IIInflationPercentageProvider.sol";
import { IIAccountingClose } from "../../accounting/interface/IIAccountingClose.sol";
import { SupplyAccounting } from "../../accounting/implementation/SupplyAccounting.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafePct } from "../../utils/implementation/SafePct.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

import "hardhat/console.sol";

// TODO: Define events

/**
    - Take in an annual percentage rate of inflation
    - Take in a supply
    - Authorize and post expected annual inflation
 */
abstract contract InflationAuthorizer is Governed, IFlareKeep, IIAccountingClose {
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using SafePct for uint256;
    using BokkyPooBahsDateTimeLibrary for uint256;

    // Constants
    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points
    string internal constant ERR_CLOSE_MANAGER_ONLY = "close manager only";    

    // Structs
    struct InflationAnnum {
        uint256 inflationToAllocateTWei;
        uint16 daysInAnnum;
        uint256 startTimeStamp;
        uint256 endTimeStamp;
        uint256 mintingAuthorizedTwei;
    }

    // Public state
    uint256 public nextAuthorizationTs;                               // The next time inflation authorization is to
                                                                      //     be computed; it is done in advance
    uint256 public authorizationRequestFrequencySec;                  // Delay between authorizations
    uint256 public startAuthorizingAtTs;                              // The timestamp authorizing is to begin
    uint256 public currentAnnum;                                      // Array index of current InflationAnnum
    InflationAnnum[] public inflationAnnums;                          // Array of annual inflation data
    IIInflationPercentageProvider public inflationPercentageProvider; // Source for fetching the effective 
                                                                      //    annual inflation rate for this contract
    SupplyAccounting public supplyAccounting;                         // Source for yielding the total inflatable 
                                                                      //    token supply
    CloseManager public closeManager;                                 // Managing contract to synchronize closing of 
                                                                      //    local sub-ledgers across the system
    uint256 internal lastAuthorizedAmountTWei;
    uint256 internal lastAuthorizationTs;   

    modifier onlyCloseManager {
        require(msg.sender == address(closeManager), ERR_CLOSE_MANAGER_ONLY);
        _;
    }

    constructor(address _governance, 
        uint256 _authorizationRequestFrequencySec,
        uint256 _startAuthorizingAtTs,
        IIInflationPercentageProvider _inflationPercentageProvider,
        SupplyAccounting _supplyAccounting,
        CloseManager _closeManager
    ) Governed(_governance) {
        require(_authorizationRequestFrequencySec != 0, "frequency zero");        
        require(address(_inflationPercentageProvider) != address(0), "inflationPercentageProvider zero");
        require(address(_supplyAccounting) != address(0), "supplyAccounting zero");

        // TODO: Need a way to reset these addresses
        inflationPercentageProvider = _inflationPercentageProvider;
        supplyAccounting = _supplyAccounting;
        authorizationRequestFrequencySec = _authorizationRequestFrequencySec;
        startAuthorizingAtTs = _startAuthorizingAtTs;
        nextAuthorizationTs = startAuthorizingAtTs;
        closeManager = _closeManager;
    }

    /**
     * @notice sets CloseManager
     */
    function setCloseManager(CloseManager _closeManager) external override onlyGovernance {
        closeManager = _closeManager;
    }

    function computeAnnualInflationTWei() internal returns(uint256) {
        return supplyAccounting.getInflatableSupplyBalance().mulDiv(
            inflationPercentageProvider.getAnnualPercentageBips(), 
            BIPS100);
    }

    function computeDaysInAnnum(uint256 startTimeStamp) internal pure returns(uint16) {
        // This should cover passing through Feb 29
        uint256 nextYearTimeStamp = startTimeStamp.addYears(1);
        uint256 daysInAnnum = startTimeStamp.diffDays(nextYearTimeStamp);
        return daysInAnnum.toUint16();
    }

    function computePeriodsRemainingInAnnum(uint256 atTimeStamp) internal view returns(uint256) {
        uint256 endTimeStamp = inflationAnnums[currentAnnum].endTimeStamp;
        if (atTimeStamp > endTimeStamp) {
            return 0;
        } else {
            uint256 diffSeconds = endTimeStamp.sub(atTimeStamp);
            return diffSeconds.div(authorizationRequestFrequencySec);
        }
    }

    function computeProportionOfTimeElapsedSinceLastAuthorizationBips(
        uint256 atTimeStamp
    )
        internal view 
        returns(uint256)
    {
        if (atTimeStamp < lastAuthorizationTs) {
            return 0;
        }
        if (atTimeStamp > nextAuthorizationTs) {
            return BIPS100;
        }
        return (atTimeStamp.sub(lastAuthorizationTs)).mul(BIPS100)
            .div((nextAuthorizationTs.sub(lastAuthorizationTs)));
    }

    function getAnnumEndsTs(uint256 startTimeStamp) internal pure returns (uint256) {
        return startTimeStamp.addYears(1).subSeconds(1);
    }

    /**
        - Get the new annual inflation amount from governance.
        - Make sure we know how many days are in this annum (accounting for leap years).
        - Deal with any leftover inflation that was not authorized to be minted, in case
            there were timing differences, or slipage of validators not calling keep regularly.
        - Set up a new annual inflation structure.
        - Set the current annum pointer to new structure.
     */
    function initNewAnnum() internal virtual {
        uint256 annualInflationTWei = computeAnnualInflationTWei();
        uint16 daysInAnnum = computeDaysInAnnum(block.timestamp);

        uint256 leftoverInflationNotAuthorized = 0;
        if (inflationAnnums.length > 0) {
            leftoverInflationNotAuthorized = inflationAnnums[currentAnnum].inflationToAllocateTWei
                .sub(inflationAnnums[currentAnnum].mintingAuthorizedTwei);
        }

        InflationAnnum memory newAnnum = InflationAnnum({
            inflationToAllocateTWei: annualInflationTWei.add(leftoverInflationNotAuthorized),
            daysInAnnum: daysInAnnum,
            startTimeStamp: block.timestamp,
            endTimeStamp: getAnnumEndsTs(block.timestamp),
            mintingAuthorizedTwei: 0
        });

        inflationAnnums.push(newAnnum);

        if (inflationAnnums.length > 1) {
            currentAnnum = currentAnnum.add(1);
        }
    }

    /**
     * @notice Calculate the amount of time remaining between the current block
     *   timestamp and the next authorization time stamp, and back out the proportional
     *   amount of inflation that has not been authorized as of now.
     */
    function close() external override onlyCloseManager {
        uint256 toClawBack = 
            lastAuthorizedAmountTWei - 
            lastAuthorizedAmountTWei.mulDiv(
                computeProportionOfTimeElapsedSinceLastAuthorizationBips(block.timestamp), 
                BIPS100);

        if (toClawBack != 0) {
            InflationAnnum storage inflationAnnum = inflationAnnums[currentAnnum];
            inflationAnnum.mintingAuthorizedTwei = inflationAnnum.mintingAuthorizedTwei.sub(toClawBack);
            authorizeMintingCallback(toClawBack.toInt256().mul(-1));
        }
    }

    /**
        - There are two parts to consider here: 1) is it time to make the annual inflation calc,
            and 2) is it time to authorize some inflation so that it can become mintable?
        Part 1:
        - Determine whether it is time to make an annual inflation posting from governance.
        - Compute the amount of inflation to authorize.
        - Update accounting system with that annual posting.
        Part 2:
        - Authorization of minting is done in advance, not arrears. Determine whether it is time to do
            the next authorization tranche.
        - Determine the amount to authorize based on the amount that remains and the number of periods
            that remain in the current annum.
     */
    function keep() public virtual override returns(bool) {
        // Annual inflation calc and new annum structure creation
        if (inflationAnnums.length == 0 || block.timestamp > inflationAnnums[currentAnnum].endTimeStamp) {
            initNewAnnum();
        }
        // Periodic minting authorization of inflation
        if (block.timestamp >= nextAuthorizationTs) {
            lastAuthorizationTs = block.timestamp;
            nextAuthorizationTs = nextAuthorizationTs.add(authorizationRequestFrequencySec);
            InflationAnnum storage inflationAnnum = inflationAnnums[currentAnnum];
            uint256 nextAuthorizationTWei = 
                inflationAnnum.inflationToAllocateTWei
                .sub(inflationAnnum.mintingAuthorizedTwei)
                .div(computePeriodsRemainingInAnnum(block.timestamp));
            inflationAnnum.mintingAuthorizedTwei = 
                inflationAnnum.mintingAuthorizedTwei.add(nextAuthorizationTWei);
            authorizeMintingCallback(nextAuthorizationTWei.toInt256());
            lastAuthorizedAmountTWei = nextAuthorizationTWei;
        }
        return true;
    }

    /**
     * @notice Callback function that can be used for a specific type of inflation to 
     *   authorize for minting, so that GL accounts specific to that type of inflation
     *   can be accounted for.
     */
    function authorizeMintingCallback(int256 _authorizationAmountTWei) internal virtual;
}
