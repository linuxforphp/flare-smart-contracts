// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {ICollateralizable} from "../interface/ICollateralizable.sol";
import {Governed} from "../../governance/implementation/Governed.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {VPToken} from "../../token/implementation/VPToken.sol";
import {VPContract} from "../../token/implementation/VPContract.sol";

/**
 * @title FAsset Token
 * @notice A smart contract to represent off-chain tokens on the Flare network.
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block, and collateralized minting.
 **/
contract FAssetToken is VPToken {
    using SafeMath for uint256;
    
    constructor(
        address _governance,
        string memory _name, 
        string memory _symbol,
        uint8 decimals_
    ) VPToken(_governance, _name, _symbol) {
        _setupDecimals(decimals_);
    }

    function mint(address to, uint256 amount) external onlyGovernance {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyGovernance {
        _burn(from, amount);
    }
}
