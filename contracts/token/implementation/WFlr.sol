// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {VPToken} from "./VPToken.sol";
import {VPContract} from "./VPContract.sol";
import {IWFlr} from "../../userInterfaces/IWFlr.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title Wrapped Flare token
 * @notice Accept FLR deposits and mint ERC20 WFLR tokens 1-1.
 * @dev Attribution: https://rinkeby.etherscan.io/address/0xc778417e063141139fce010982780140aa0cd5ab#code 
 */
contract WFlr is VPToken, IWFlr {
    using SafeMath for uint256;
    event  Deposit(address indexed dst, uint amount);
    event  Withdrawal(address indexed src, uint amount);

    /**
     * Construct an ERC20 token.
     */
    constructor(address _governance) VPToken(_governance, "Wrapped FLR", "WFLR") {
    }
    
    receive() external payable {
        deposit();
    }

    /**
     * @notice Withdraw WFLR from an owner and send FLR to msg.sender given an allowance.
     * @param owner An address spending the Flare tokens.
     * @param amount The amount to spend.
     *
     * Requirements:
     *
     * - `owner` must have a balance of at least `amount`.
     * - the caller must have allowance for `owners`'s tokens of at least
     * `amount`.
     */
    function withdrawFrom(address owner, uint256 amount) external override {
        // Reduce senders allowance
        _approve(owner, msg.sender, allowance(owner, msg.sender).sub(amount, "allowance below zero"));
        // Burn the owners balance
        _burn(owner, amount);
        // Emit withdraw event
        emit Withdrawal(owner, amount);
        // Move value to sender (last statement, to prevent reentrancy)
        msg.sender.transfer(amount);
    }

    /**
     * @notice Deposit Flare from msg.sender to recipient and and mint WFLR ERC20.
     * @param recipient A payable address to receive Flare and minted WFLR.
     */
    function depositTo(address recipient) external payable override {
        require(recipient != address(0), "Cannot deposit to zero address");
        // Mint WFLR
        _mint(recipient, msg.value);
        // Emit deposit event
        emit Deposit(recipient, msg.value);
    }

    /**
     * @notice Deposit Flare and mint wFlr ERC20.
     */
    function deposit() public payable override {
        // Mint WFLR
        _mint(msg.sender, msg.value);
        // Emit deposit event
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw Flare and burn WFLR ERC20.
     * @param amount The amount to withdraw.
     */
    function withdraw(uint256 amount) external override {
        // Burn WFLR tokens
        _burn(msg.sender, amount);
        // Emit withdrawal event
        emit Withdrawal(msg.sender, amount);
        // Send Flare to sender (last statement, to prevent reentrancy)
        msg.sender.transfer(amount);
    }
}
