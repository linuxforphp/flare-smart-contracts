// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {ICollateralizable} from "../ICollateralizable.sol";
import {Governed} from "./Governed.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {VPToken} from "./VPToken.sol";

/**
 * @title FAsset Token
 * @notice A smart contract to represent off-chain tokens on the Flare network.
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block, and collateralized minting.
 **/
contract FAssetToken is Governed, VPToken {
    using SafeMath for uint256;
    
    constructor(
        address governance_,
        string memory name_, 
        string memory symbol_) Governed(governance_) VPToken(name_, symbol_)

    { }

    function mint(address to, uint256 amount) external onlyGovernance {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyGovernance {
        _burn(from, amount);
    }
}