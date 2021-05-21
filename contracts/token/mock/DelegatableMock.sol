// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {Delegatable} from "../implementation/Delegatable.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {CheckPointHistory} from "../lib/CheckPointHistory.sol";

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
    
    function name() public pure override returns (string memory) {
        return "DelegatableMock";
    }
    function symbol() public pure override returns (string memory) {
        return "DMOK";
    }
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function balanceOf(address who) public override view returns (uint256) {
        return _senderBalances[who].valueAtNow();
    }

    function balanceOfAt(address who, uint256 blockNumber) public override view returns (uint256) {
        return _senderBalances[who].valueAt(blockNumber);
    }

    function addUpdateBalance(address who, uint256 balance) private {
        _senderBalances[who].writeValue(balanceOf(who).add(balance));
    }

    function subtractBalance(address who, uint256 balance) private {
        _senderBalances[who].writeValue(balanceOf(who).sub(balance));
    }

    function delegate(address to, uint256 bips) public override {
        _delegateByPercentage(to, balanceOf(msg.sender), bips);
    }

    function delegateExplicit(address to, uint votePower) public override {
        _delegateByAmount(to, balanceOf(msg.sender), votePower);
    }

    function undelegateAll() public override {
        _undelegateAllByPercentage(balanceOf(msg.sender));
    }
    
    function undelegateAllExplicit(address[] memory delegateAddresses) external override {
        _undelegateAllByAmount(delegateAddresses, balanceOf(msg.sender));
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

    function revokeDelegationAt(address who, uint blockNumber) external override {
        _revokeDelegationAt(who, balanceOfAt(msg.sender, blockNumber), blockNumber);
    }

    function votePowerFromTo(address from, address to) external view override returns(uint256) {
        return _votePowerFromTo(from, to, balanceOf(from));
    }
    
    function votePowerFromToAt(address from, address to, uint blockNumber) external view override returns(uint256) {
        return _votePowerFromToAt(from, to, balanceOfAt(from, blockNumber), blockNumber);
    }
    
    // empty implementations, to satisfy the IVPToken contract    
    function allowance(address owner, address spender) external override view returns (uint256) {}
    function approve(address spender, uint256 amount) external override returns (bool) {}
    function totalSupply() external override view returns (uint256) {}
    function transfer(address recipient, uint256 amount) external override returns (bool) {}
    function transferFrom(address sender, address recipient, uint256 amount) external override returns (bool) {}
    function totalSupplyAt(uint blockNumber) public view override returns(uint256) {}
    function votePower() public view override returns(uint256) {}
    function votePowerAt(uint blockNumber) public view override returns(uint256) {}
    function votePowerAtCached(uint blockNumber) public override returns(uint256) {}
}