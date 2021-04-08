// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


import "../interfaces/IFlareKeep.sol";

contract Kept is IFlareKeep {
    uint256 public lastKept;
    uint256 public tickleCount;

    /// implement this function for recieving a trigger from FlareKeeper
    function keep() external override returns(bool) {
        lastKept = block.number;
        return true;
    }

    function tickle() external {
        tickleCount += 1;
    }
}