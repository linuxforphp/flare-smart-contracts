// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IVPToken.sol";

// import "hardhat/console.sol";

contract MockVPToken is IVPToken {
    /* solhint-disable ordering */

    uint8 public _decimals = 0;
    string public _name = "MockVPToken";
    string public _symbol = "MVPT";

    mapping(address => uint256) internal addressWeight;
    uint256 public totalWeight;
    uint256 public addressCount;    
    
    // In case weights.length = 0, FLR balance is returned for one of the addresses.
    constructor(address[] memory addresses, uint256[] memory weights) {
        require(addresses.length == weights.length || weights.length == 0, "Error in parameters");
        addressCount = addresses.length;
        for (uint256 i = 0; i < addresses.length; i++) {
            addressWeight[addresses[i]] = weights.length > 0 ? weights[i] : addresses[i].balance;
            if(weights.length > 0) {
                totalWeight += weights[i];
            } else {
                totalWeight += addresses[i].balance;
            }
        }
    }
    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() external view override returns (string memory) {
        return _name;
    }

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() external view override returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Should be compatible with ERC20 method
     */

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function votePower() public view override returns(uint256) {}
    function votePowerAt(uint blockNumber) public view override returns(uint256) {
        blockNumber;
        return totalWeight;
    }
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
        return addressWeight[who];
    }

    // empty implementations, to satisfy the IVPToken contract    
    /* solhint-disable no-unused-vars */
    function allowance(address owner, address spender) external override view returns (uint256) {}
    function approve(address spender, uint256 amount) external override returns (bool) {}
    function balanceOf(address account) external override view returns (uint256) {}
    function totalSupply() external override view returns (uint256) {}
    function transfer(address recipient, uint256 amount) external override returns (bool) {}
    function transferFrom(address sender, address recipient, uint256 amount) external override returns (bool) {}
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
