// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {VotePower} from "../../lib/VotePower.sol";

/**
 * @title Vote Power mock contract
 * @notice A contract to expose the VotePower library for unit testing.
 **/
contract VotePowerMock {
    using VotePower for VotePower.VotePowerState;

    VotePower.VotePowerState private _self;

    function _burn(
        address owner, 
        uint256 amount) public {
        _self._burn(owner, amount);
    }

    function delegate(
        address delegator, 
        address delegatee,
        uint256 amount) public {
        _self.delegate(delegator, delegatee, amount);
    }

    function _mint(
        address owner, 
        uint256 amount) public {
        _self._mint(owner, amount);
    }

    function revokeAt(
        address delegator, 
        address delegatee, 
        uint256 blockNumber
    ) public returns (uint256 votePowerRevoked) {
        return _self.revokeAt(delegator, delegatee, blockNumber);
    }

    function transmit(
        address from, 
        address to,
        uint256 amount
    ) public {
        _self.transmit(from, to, amount);
    }

    function undelegate(
        address delegator, 
        address delegatee,
        uint256 amount) public {
        _self.undelegate(delegator, delegatee, amount);
    }

    function votePowerAt(
        uint256 blockNumber)
        public view returns(uint256 votePower) {
        return _self.votePowerAt(blockNumber);
    }

    function votePowerAtNow()
        public view returns(uint256 votePower) {
        return _self.votePowerAtNow();
    }

    function votePowerFromToAt(
        address from, 
        address to, 
        uint blockNumber)
        public view returns(uint256 votePower) {
        return _self.votePowerFromToAt(from, to, blockNumber);
    }

    function votePowerFromToAtNow(
        address from, 
        address to)
        public view returns(uint256 votePower) {
        return _self.votePowerFromToAtNow(from, to);
    }

    function votePowerOfAt(
        address who, 
        uint256 blockNumber)
        public view returns(uint256 votePower) {
        return _self.votePowerOfAt(who, blockNumber);
    }

    function votePowerOfAtNow(
        address who)
        public view returns(uint256 votePower) {
        return _self.votePowerOfAtNow(who);
    }
}