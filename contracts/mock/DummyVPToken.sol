// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../IVPToken.sol";

contract DummyVPToken is ERC20, IVPToken {
    uint256 public constant MINTAMOUNT = 700 * 10 ** 18; 
    constructor (string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, MINTAMOUNT);
    }

    /// @notice delegate percentage of vote power. up to x addresses. 
    /// any undelegated vote power is seen as delegated to self.
    /// howMuch units are percentage. i.e. max total delegation is 100.
    /// @dev to remove delegation set howMuch to 0
    function delegate(DelegationData[] calldata delegationData) external override {

    }

    /// @notice delegate explicit amount of voting power (in token units)
    /// @notice with delegateExplicit, must un delegate tokens before transferring out
    /// @dev un delegate by setting delegation for address to 0.
    function delegateExplicit(DelegationData[] calldata delegationData) external override {
        
    }

    /// vote power for current block
    function votePowerOf(address who) external view override returns (uint256) {
        return votePowerOfAt(who, block.number);
    }


    /// @return delegations percent - array of address delegating to me at this block
    function getDelegationsOf (address who) external view override
        returns(address[] memory delegations, uint256[] memory percent)
    {

    }

    /// @notice for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerOfAt (address who, uint256 blockNumber) public view override
        returns (uint64)
    {
        blockNumber;
        return uint64(balanceOf(who) / 1e18);
    }
}
