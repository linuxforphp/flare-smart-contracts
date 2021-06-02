// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IIInflationReceiver {
    function setDailyAuthorizedInflation(uint256 toAuthorizeWei) external;
    function receiveInflation() external payable;
}
