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

    mapping(address => CheckPointHistory.CheckPointHistoryState) private senderBalances;

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

    function balanceOf(address _who) public override view returns (uint256) {
        return senderBalances[_who].valueAtNow();
    }

    function balanceOfAt(address _who, uint256 _blockNumber) public override view returns (uint256) {
        return senderBalances[_who].valueAt(_blockNumber);
    }

    function addUpdateBalance(address _who, uint256 _balance) private {
        senderBalances[_who].writeValue(balanceOf(_who).add(_balance));
    }

    function subtractBalance(address _who, uint256 _balance) private {
        senderBalances[_who].writeValue(balanceOf(_who).sub(_balance));
    }

    function delegate(address _to, uint256 _bips) public override {
        _delegateByPercentage(_to, balanceOf(msg.sender), _bips);
    }

    function delegateExplicit(address _to, uint256 _votePower) public override {
        _delegateByAmount(_to, balanceOf(msg.sender), _votePower);
    }

    function undelegateAll() public override {
        _undelegateAllByPercentage(balanceOf(msg.sender));
    }
    
    function undelegateAllExplicit(address[] memory _delegateAddresses) external override {
        _undelegateAllByAmount(_delegateAddresses, balanceOf(msg.sender));
    }

    function burnVotePower(address _owner, uint256 _amount) public {
        subtractBalance(_owner, _amount);
        _burnVotePower(_owner, balanceOf(_owner), _amount);
    }

    function mintVotePower(address _owner, uint256 _amount) public {
        addUpdateBalance(_owner, _amount);
        _mintVotePower(_owner, _amount);
    }

    function transmitVotePower(address from, address to, uint256 _amount) public {
        _transmitVotePower(from, to, balanceOf(from), _amount);
    }

    function undelegatedVotePowerOf(address _owner) public view override returns(uint256 _votePower) {
        return _undelegatedVotePowerOf(_owner, balanceOf(_owner));
    }

    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) 
        public view override returns (uint256 _votePower) {
        return _undelegatedVotePowerOfAt(_owner, balanceOfAt(_owner, _blockNumber), _blockNumber);
    }

    function revokeDelegationAt(address _who, uint256 _blockNumber) external override {
        _revokeDelegationAt(_who, balanceOfAt(msg.sender, _blockNumber), _blockNumber);
    }

    function votePowerFromTo(address _from, address _to) external view override returns(uint256) {
        return _votePowerFromTo(_from, _to, balanceOf(_from));
    }
    
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _blockNumber
    ) external view override returns(uint256) {
        return _votePowerFromToAt(_from, _to, balanceOfAt(_from, _blockNumber), _blockNumber);
    }
    
    // empty implementations, to satisfy the IIVPToken contract    
    function allowance(address _owner, address _spender) external override view returns (uint256) {}
    function approve(address _spender, uint256 _amount) external override returns (bool) {}
    function totalSupply() external override view returns (uint256) {}
    function transfer(address _recipient, uint256 _amount) external override returns (bool) {}
    function transferFrom(address _sender, address _recipient, uint256 _amount) external override returns (bool) {}
    function totalSupplyAt(uint256 _blockNumber) public view override returns(uint256) {}
    function votePower() public view override returns(uint256) {}
    function votePowerAt(uint256 _blockNumber) public view override returns(uint256) {}
    function votePowerAtCached(uint256 _blockNumber) public override returns(uint256) {}
}
