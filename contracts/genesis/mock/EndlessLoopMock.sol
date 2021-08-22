// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IFlareDaemonize.sol";

contract EndlessLoopMock is IFlareDaemonize {
    uint256 public aNumber;

    function daemonize() external override returns (bool) {
        while (true) {
            aNumber++;
        }
        return true;
    }
}
