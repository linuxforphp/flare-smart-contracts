// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IIInflationPercentageProvider {
    function getAnnualPercentageBips() external returns(uint256);
}
