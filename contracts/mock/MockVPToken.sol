// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IFAsset.sol";

// import "hardhat/console.sol";

contract MockVPToken is IFAsset {

    uint8 public _decimals = 0;
    string public _name = "MockVPToken";
    string public _symbol = "MVPT";

    mapping(address => uint64) internal addressWeight;
    uint256 public totalWeight;
    uint256 public addressCount;    
    
    // In case weights.length = 0, FLR balance is returned for one of the addresses.
    constructor(address[] memory addresses, uint64[] memory weights) {
        require(addresses.length == weights.length || weights.length == 0, "Error in parameters");
        addressCount = addresses.length;
        for (uint256 i = 0; i < addresses.length; i++) {
            addressWeight[addresses[i]] = weights.length > 0 ? weights[i] : uint64(addresses[i].balance);
            if(weights.length > 0) {
                totalWeight += weights[i];
            } else {
                totalWeight += uint64(addresses[i].balance);
            }
        }
    }

    function votePower() public view override returns(uint256) {}
    function votePowerAt(uint blockNumber) public view override returns(uint256) {
        blockNumber;
        return totalWeight;
    }
    function votePowerFromTo(address from, address to) public view override returns(uint256) {}
    function votePowerFromToAt(address from, address to, uint blockNumber) public view override returns(uint256) {}

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

    function undelegatedVotePowerOf(address owner) public view override returns(uint256) {}
}
