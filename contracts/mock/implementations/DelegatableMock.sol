// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {Delegatable} from "../../implementations/Delegatable.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Delegatable mock contract
 * @notice A contract to instantiate the abstract Delegatable contract for unit testing.
 **/
contract DelegatableMock is Delegatable {
    using SafeMath for uint256;

    mapping (address => uint256) private _senderBalances;

    constructor() Delegatable() {
    }

    function addUpdateBalance(address who, uint256 balance) private {
        _senderBalances[who] = _senderBalances[who].add(balance);
    }

    function subtractBalance(address who, uint256 balance) private {
        _senderBalances[who] = _senderBalances[who].sub(balance);
    }

    function delegate(address to, uint16 bips) public override {
        _delegateByPercentage(to, _senderBalances[msg.sender], bips);
    }

    function delegateExplicit(address to, uint votePower) public override {
        _delegateByAmount(to, _senderBalances[msg.sender], votePower);
    }

    function undelegateAll() public override {
        _undelegateAll(_senderBalances[msg.sender]);
    }

    function burnVotePower(address owner, uint256 amount) public {
        subtractBalance(owner, amount);
        _burnVotePower(owner, _senderBalances[owner], amount);
    }

    function mintVotePower(address owner, uint256 amount) public {
        addUpdateBalance(owner, amount);
        _mintVotePower(owner, amount);
    }

    function transmitVotePower(address from, address to, uint256 amount) public {
        _transmitVotePower(from, to, _senderBalances[from], amount);
    }

    function undelegatedVotePowerOf(address owner) public view override returns(uint256 votePower) {
        return _undelegatedVotePowerOf(owner, _senderBalances[owner]);
    }
}