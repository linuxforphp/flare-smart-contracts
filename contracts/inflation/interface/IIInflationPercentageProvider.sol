// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IIInflationPercentageProvider {
    /**
     * Return the annual inflation rate in bips.
     */
    function getAnnualPercentageBips() external returns(uint256);
}
