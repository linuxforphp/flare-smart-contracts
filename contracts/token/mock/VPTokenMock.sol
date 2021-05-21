// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {VPToken} from "../implementation/VPToken.sol";

/**
 * @title Vote Power Token mock contract
 * @notice A contract to stub minting and burning for testing purposes.
 **/
contract VPTokenMock is VPToken {

    constructor(
        string memory name_, 
        string memory symbol_) VPToken(name_, symbol_) {
    }

    function mint(address to, uint256 amount) public virtual {
        _mint(to, amount);
    }

    function burn(uint256 amount) public virtual {
        _burn(_msgSender(), amount);
    }

    function setDecimals(uint8 decimals) public {
        _setupDecimals(decimals);
    }
    
    // some forbidden functions
    
    function revokeDelegationAtNow(address to) public {
        revokeDelegationAt(to, block.number);
    }

    function votePowerOfAtNowCached(address who) public returns (uint256) {
        return votePowerOfAtCached(who, block.number);
    }
    
    function votePowerAtNowCached() public returns (uint256) {
        return votePowerAtCached(block.number);
    }
}
