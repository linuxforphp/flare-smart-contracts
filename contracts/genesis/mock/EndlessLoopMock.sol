// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IFlareKeep.sol";

contract EndlessLoopMock is IFlareKeep {
    uint256 public aNumber;

    function keep() external override returns (bool) {
        while(true) {
            aNumber++;
        }
        return true;
    }
}
