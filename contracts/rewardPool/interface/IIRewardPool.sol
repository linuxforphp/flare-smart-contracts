// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { Supply } from "../../accounting/implementation/Supply.sol";

interface IIRewardPool {

    function totalSupplyWei() external returns (uint256);

    function distributedSupplyWei() external returns (uint256);

    function setSupply(Supply _supply) external;

}