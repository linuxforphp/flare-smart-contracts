// SPDX-License-Identifier: MIT
pragma solidity 0.8.1;


contract HealthCheck {
    uint256 public counter;

    function tick() external {
        counter +=1;
    }
}
