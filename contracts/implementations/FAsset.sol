// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

// import "../IFAsset.sol"; 
import "./FAssetToken.sol";
import "../interfaces/IFlareKeep.sol";
import "./VPToken.sol";

///contract to handle fasset miting / redmption / auction.
/// delegation and vote power inherited form VPToken which
/// inherits ERC20 for transfer functionality
abstract contract FAsset is VPToken, FAssetToken, IFlareKeep {

    
    /// book keeping for Agents delegation for all FLR collateral
    ////////////////////////////////
    struct AgentDelegation {
        uint256 votePower;
        address agent;
    }
    // per data provider. list of delegating agents.
    mapping (address => AgentDelegation[]) public agentDelegations;
    string public assetName;

    /// TODO: @notice The EIP-712 typehash for the contract's domain
    /// TODO: bytes32 public constant DOMAIN_TYPEHASH = 
    ///       keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");

    /**
     * @notice Construct a new token
     * @param account The initial account to grant all the tokens
     */
    constructor(address account, uint totalSupply, string memory _name, string memory _symbol)
        // VPToken(_name, _symbol) // ALEN: commented because it did not work and FAsset was not used anywhere
    {
        _mint(account, totalSupply);
        assetName = _name;
        emit Transfer(address(0), account, totalSupply);
    }

    function deposit(uint256 amount) external {
        
    }
}
