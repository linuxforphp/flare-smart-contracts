// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { BokkyPooBahsDateTimeLibrary } from "../../lib/DateTimeLibrary.sol";
import { Governed } from "../../governance/implementation/Governed.sol";
import { IFlareKeep } from "../../interfaces/IFlareKeep.sol";
import { FtsoInflationAccounting } from "../../accounting/implementation/FtsoInflationAccounting.sol";
import { InflationAuthorizer } from "./InflationAuthorizer.sol";
import { IIInflationPercentageProvider } from "../interface/IIInflationPercentageProvider.sol";
import { SupplyAccounting } from "../../accounting/implementation/SupplyAccounting.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafePct } from "../../lib/SafePct.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

// TODO: Define events

/**
    - Take in an annual percentage rate of inflation
    - Take in a supply
    - Compute daily reward amount
    - Authorize and post inflation
 */
contract FtsoInflationAuthorizer is InflationAuthorizer {
    FtsoInflationAccounting public ftsoInflationAccounting;         // Make inflation accounting entries to track FLR

    constructor(address _governance, 
        uint256 _authorizationRequestFrequencySec,
        uint256 _startAuthorizingAtTs,
        IIInflationPercentageProvider _inflationPercentageProvider,
        SupplyAccounting _supplyAccounting,
        FtsoInflationAccounting _ftsoInflationAccounting
    ) InflationAuthorizer(_governance,
        _authorizationRequestFrequencySec,
        _startAuthorizingAtTs,
        _inflationPercentageProvider,
        _supplyAccounting) {
        require(address(_ftsoInflationAccounting) != address(0), "ftsoInflationAccounting zero");

        // TODO: Need a way to reset these addresses...add setter
        ftsoInflationAccounting = _ftsoInflationAccounting;

        // It would be nice to be able to call init annum here, but alas
        // you need to grant permission for this contract to post to
        // FtsoInflationAccounting, but this contract needs to exist first.
    }

    function initNewAnnum() internal override {
        super.initNewAnnum();
        ftsoInflationAccounting.inflateForAnnum(inflationAnnums[currentAnnum].inflationToAllocateTWei);
    }

    function authorizeMintingCallback(uint256 _nextAuthorizationTWei) internal override {
        ftsoInflationAccounting.authorizeMinting(_nextAuthorizationTWei);
    }
}