// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { CloseManager } from "../implementation/CloseManager.sol";

interface IIAccountingClose {
    function close() external;
    function setCloseManager(CloseManager _closeManager) external;
}

