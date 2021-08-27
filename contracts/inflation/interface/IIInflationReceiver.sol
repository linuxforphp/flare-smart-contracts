// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IIInflationReceiver {
    /**
     * Notify the receiver that it is entitled to receive `_toAuthorizeWei` inflation amount.
     * @param _toAuthorizeWei the amount of inflation that can be awarded in the coming day
     */
    function setDailyAuthorizedInflation(uint256 _toAuthorizeWei) external;
    
    /**
     * Receive native tokens from inflation.
     */
    function receiveInflation() external payable;
}
