// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { Supply } from "../../accounting/implementation/Supply.sol";

interface IIRewardManager {

    function setSupply(Supply _supply) external;

}