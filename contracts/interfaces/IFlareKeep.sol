// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


/// Any contracts that want to recieve a trigger from Flare keeper should 
///     implement IFlareKeep
interface IFlareKeep {

    /// implement this function for recieving a trigger from FlareKeeper
    function keep() external;
}
