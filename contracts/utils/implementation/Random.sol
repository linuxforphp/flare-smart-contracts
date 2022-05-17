// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../userInterfaces/IFtsoRegistry.sol";

abstract contract Random {

    IFtsoRegistry private ftsoRegistry;

    constructor(address _ftsoRegistry) {
        ftsoRegistry = IFtsoRegistry(_ftsoRegistry);
    }

    function _getRandom() internal view returns (uint256) {
        uint256 random = block.timestamp;
        IIFtso[] memory ftsos = ftsoRegistry.getSupportedFtsos();
        //slither-disable-next-line weak-prng
        uint256 ftsoRandom = ftsos[random % ftsos.length].getCurrentRandom();
        //slither-disable-next-line weak-prng
        return uint256(keccak256(abi.encode(random, ftsoRandom)));
    }

}
