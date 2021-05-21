// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../userInterfaces/IVPToken.sol";

contract DummyVPToken is ERC20, IVPToken {
    /* solhint-disable ordering */
    
    uint256 public constant MINTAMOUNT = 700 * 10 ** 18; 
    constructor (string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, MINTAMOUNT);
    }

    function name() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.name();
    }
    function symbol() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.symbol();
    }
    function decimals() public view override(ERC20, IVPToken) returns (uint8) {
        return ERC20.decimals();
    }

    function votePower() public view override returns(uint256) {}
    function votePowerAt(uint blockNumber) public view override returns(uint256) {}

    /// vote power for current block
    function votePowerOf(address who) public view override returns (uint256) {
        return votePowerOfAt(who, block.number);
    }

    /// @notice for any cotracts wishing to share rewards with depositers, this
    ///     function enables to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerOfAt(address who, uint256 blockNumber) public view override
        returns (uint256)
    {
        blockNumber;
        return balanceOf(who) / 1e18;
    }

    // empty implementations, to satisfy the IVPToken contract    
    /* solhint-disable no-unused-vars */
    function totalSupplyAt(uint blockNumber) public view override returns(uint256) {}
    function balanceOfAt(address owner, uint blockNumber) public view override returns (uint256) {}
    function delegate(address to, uint256 bips) external override {}
    function delegateExplicit(address to, uint256 amount) external override {}
    function delegationModeOf(address who) public view override returns (uint256 delegationMode) {}
    function undelegatedVotePowerOf(address owner) public view override returns(uint256) {}
    function undelegatedVotePowerOfAt(address owner, uint256 blockNumber) public view override returns (uint256) {}
    function undelegateAll() external override {}
    function undelegateAllExplicit(address[] memory delegateAddresses) external override {}
    function delegatesOfAt(address owner, uint256 blockNumber) public view override 
        returns (address[] memory delegateAddresses, uint256[] memory bips, uint256 count, uint256 delegationMode) {}
    function delegatesOf(address owner) public view override 
        returns (address[] memory delegateAddresses, uint256[] memory bips, uint256 count, uint256 delegationMode) {}
    function revokeDelegationAt(address who, uint blockNumber) public override {}
    function votePowerFromTo(address from, address to) external view override returns(uint256) {}
    function votePowerFromToAt(address from, address to, uint blockNumber) external view override returns(uint256) {}
}
