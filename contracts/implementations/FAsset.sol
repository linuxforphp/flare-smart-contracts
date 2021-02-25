// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../IFAsset.sol"; 
import "../utils/FlareUtils.sol";
import "./VPToken.sol";

///contract to handle fasset miting / redmption / auction.
/// delegation and vote power inherited form VPToken which
/// inherits ERC20 for transfer functionality
contract FAsset is VPToken, IFAsset, FlareUtils {

    string immutable name;

    /// book keeping for Agents delegation for all FLR collateral
    ////////////////////////////////
    struct AgentDelegation {
        uint256 votePower;
        address agent;
    }
    // per data provider. list of delegating agents.
    mapping (address => AgentDelegation[]) agentDelegations;

    /// TODO: @notice The EIP-712 typehash for the contract's domain
    /// TODO: bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    /**
     * @notice Construct a new token
     * @param account The initial account to grant all the tokens
     */
    constructor(address account, uint totalSupply, string _name) {
        balances[account] = uint96(totalSupply);
        name = _name;
        emit Transfer(address(0), account, totalSupply);
    }

    function deposit(uint256 amount) {
        
    }
}
