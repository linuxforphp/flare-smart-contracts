// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../implementation/FlareDaemon.sol";

contract TestableFlareDaemon is FlareDaemon {
    /**
     * Testable version of trigger - no check for message origin.
     */
    function trigger() external override inflationSet mustBalance returns (uint256 _toMintWei) {
        return triggerInternal();
    }
}
