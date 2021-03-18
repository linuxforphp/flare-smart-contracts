// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


/// major kept contracts
///     - FTSO (finalize reveal)
///     - reward contract distribute rewards
///     - FAsset contract auction defaulting agents
interface IFlareKeeper {

    /// triggered per state trasition.
    /// per block flow:
    ///     - save last triggered block
    ///     - call registered contracts
    function keep() external;

    /// register a contract to be triggered per block
    // function registerContractToKeep(KeptContract _toKeep) external;
}