// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { Governed } from "./Governed.sol";
import { IIInflationPercentageProvider } from "../../inflation/interface/IIInflationPercentageProvider.sol";

/**
 * @title Inflation allocation contract
 * @notice This contract implements settings agreed upon by Flare Foundation governance.
 **/

contract InflationAllocation is Governed {
    constructor(address _governance) Governed(_governance) {}

    function getFtsoInflationAnnualPercentageBips() external pure returns(uint256) {
        return 900;
    }
}

contract FtsoInflationPercentageProvider is IIInflationPercentageProvider {
    InflationAllocation public inflationAllocation;

    constructor(InflationAllocation _inflationAllocation) {
        inflationAllocation = _inflationAllocation;
    }

    function getAnnualPercentageBips() external view override returns(uint256) {
        return inflationAllocation.getFtsoInflationAnnualPercentageBips();
    }
}
