// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/// A kept contract can register to Flare keeper contracts and be triggered per new block
interface IKeep {
    function keep() external returns(bool);
}
