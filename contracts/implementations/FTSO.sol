// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "../IVPToken.sol";

contract FTSO {

    uint256 constant PRICE_DECIMALS = 4;

    IVPToken FFlr; // wrapped FLR

    IVPToken FAsset; // the Fasset for this FTSO

    /// TODO: consider mapping and not array
    uint[] private assetDollarPrice; // asset price per epoch
}

