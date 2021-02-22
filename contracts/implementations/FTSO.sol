// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "../IDelegationToken.sol";

contract FTSO {

    uint256 constant PRICE_DECIMALS = 4;

    IDelegationToken FFlr; // wrapped FLR

    IDelegationToken FAsset; // the Fasset for this FTSO

    /// TODO: consider mapping and not array
    uint[] private assetDollarPrice; // asset price per epoch
}

