// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../IVotePower.sol";

contract DummyVPToken is ERC20, IVotePower {
    uint256 public constant MINTAMOUNT = 700 * 10 ** 18; 
    constructor (string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, MINTAMOUNT);
    }

    function votePower() public view override returns(uint256) {}
    function votePowerAt(uint blockNumber) public view override returns(uint256) {}
    function votePowerFromTo(address from, address to) public view override returns(uint256) {}
    function votePowerFromToAt(address from, address to, uint blockNumber) public view override returns(uint256) {}

    /// vote power for current block
    function votePowerOf(address who) public view override returns (uint256) {
        return votePowerOfAt(who, block.number);
    }

    /// @notice for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerOfAt (address who, uint256 blockNumber) public view override
        returns (uint256)
    {
        blockNumber;
        return uint64(balanceOf(who) / 1e18);
    }

    function undelegatedVotePowerOf(address owner) public view override returns(uint256) {}
    function undelegatedVotePowerOfAt(address owner, uint256 blockNumber) public view override returns(uint256) {}
}
