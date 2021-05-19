// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {Delegatable} from "../../implementations/Delegatable.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {CheckPointHistory} from "../../lib/CheckPointHistory.sol";

/**
 * @title Delegatable mock contract
 * @notice A contract to instantiate the abstract Delegatable contract for unit testing.
 **/
contract DelegatableMock is Delegatable {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using SafeMath for uint256;

    mapping (address => CheckPointHistory.CheckPointHistoryState) private _senderBalances;

    constructor() Delegatable() {
    }
    
    function balanceOf(address who) private view returns (uint256) {
        return _senderBalances[who].valueAtNow();
    }

    function balanceOfAt(address who, uint256 blockNumber) private view returns (uint256) {
        return _senderBalances[who].valueAt(blockNumber);
    }

    function addUpdateBalance(address who, uint256 balance) private {
        _senderBalances[who].writeValueAtNow(balanceOf(who).add(balance));
    }

    function subtractBalance(address who, uint256 balance) private {
        _senderBalances[who].writeValueAtNow(balanceOf(who).sub(balance));
    }

    function delegate(address to, uint16 bips) public override {
        _delegateByPercentage(to, balanceOf(msg.sender), bips);
    }

    function delegateExplicit(address to, uint votePower) public override {
        _delegateByAmount(to, balanceOf(msg.sender), votePower);
    }

    function undelegateAll() public override {
        _undelegateAll(balanceOf(msg.sender));
    }
    
    function undelegateAllExplicit(address[] memory delegateAddresses) external override {
        _undelegateAllExplicit(delegateAddresses, balanceOf(msg.sender));
    }

    function burnVotePower(address owner, uint256 amount) public {
        subtractBalance(owner, amount);
        _burnVotePower(owner, balanceOf(owner), amount);
    }

    function mintVotePower(address owner, uint256 amount) public {
        addUpdateBalance(owner, amount);
        _mintVotePower(owner, amount);
    }

    function transmitVotePower(address from, address to, uint256 amount) public {
        _transmitVotePower(from, to, balanceOf(from), amount);
    }

    function undelegatedVotePowerOf(address owner) public view override returns(uint256 votePower) {
        return _undelegatedVotePowerOf(owner, balanceOf(owner));
    }

    function undelegatedVotePowerOfAt(address owner, uint256 blockNumber) 
        public view override returns (uint256 votePower) {
        return _undelegatedVotePowerOfAt(owner, balanceOfAt(owner, blockNumber), blockNumber);
    }

    function votePower() public view override returns(uint256) {return 0;}
    //solhint-disable-next-line no-unused-vars
    function votePowerAt(uint blockNumber) public view override returns(uint256) {return 0;}
}