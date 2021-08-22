// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


/// Any contracts that want to recieve a trigger from Flare daemon should 
///     implement IFlareDaemonize
interface IFlareDaemonize {

    /// implement this function for recieving a trigger from FlareDaemon
    function daemonize() external returns(bool);
}
