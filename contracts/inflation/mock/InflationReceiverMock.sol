// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { IIInflationReceiver } from "../interface/IIInflationReceiver.sol";

contract InflationReceiverMock is IIInflationReceiver {
    function setDailyAuthorizedInflation(uint256 toAuthorizeWei) external override {}
    function receiveInflation() external payable override {}
}