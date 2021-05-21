// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { Governed } from "./Governed.sol";
import { IIInflationPercentageProvider } from "../../inflation/interface/IIInflationPercentageProvider.sol";

/**
 * @title Constitution contract
 * @notice This contract implements settings agreed upon by Flare Foundation constitutional governance.
 **/

contract Constitution is Governed {
    constructor(address _governance) Governed(_governance) {}

    function getFtsoInflationAnnualPercentageBips() external pure returns(uint256) {
        return 900;
    }
}

contract FtsoInflationPercentageProvider is IIInflationPercentageProvider {
    Constitution public constitution;

    constructor(Constitution _constitution) {
        constitution = _constitution;
    }

    function getAnnualPercentageBips() external view override returns(uint256) {
        return constitution.getFtsoInflationAnnualPercentageBips();
    }
}