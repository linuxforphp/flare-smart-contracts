// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/DistributionTreasury.sol";


// Distribution without receive method
contract DistributionMock {

    DistributionTreasury public immutable treasury;

    constructor(DistributionTreasury _treasury) {
        treasury = _treasury;
    }

    function pullFunds(uint256 _amountWei) external {
        treasury.pullFunds(_amountWei);
    }
}
