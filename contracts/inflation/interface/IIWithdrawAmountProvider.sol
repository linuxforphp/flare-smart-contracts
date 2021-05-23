// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IIWithdrawAmountProvider {
    function getAmountTWei() external returns(uint256);
}
