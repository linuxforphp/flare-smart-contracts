// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {VPToken} from "./VPToken.sol";

/**
 * @title Wrapped Flare token
 * @notice Accept FLR deposits and mint ERC20 WFLR tokens 1-1.
 * @dev Attribution: https://rinkeby.etherscan.io/address/0xc778417e063141139fce010982780140aa0cd5ab#code 
 */
contract WFLR is VPToken {
    event  Deposit(address indexed dst, uint amount);
    event  Withdrawal(address indexed src, uint amount);

    /**
     * Construct an ERC20 token.
     */
    constructor() VPToken("Wrapped FLR", "WFLR") {
    }

    /**
     * Fallback function that will deposit Flare and issue
     * WFLR in return.
     */
    receive() external payable {
        deposit();
    }

    /**
     * @notice Withdraw from a spender to msg.sender given an allowance.
     * @param spender An address spending the Flare tokens.
     * @param amount The amount to spend.
     *
     * Requirements:
     *
     * - `spender` must have a balance of at least `amount`.
     * - the caller must have allowance for ``spenders``'s tokens of at least
     * `amount`.
     */
    function withdrawFrom(address spender, uint256 amount) public {
        // Reduce spenders allowance
        decreaseAllowance(spender, amount);
        // Burn the spenders balance
        _burn(spender, amount);
        // Move value to sender
        msg.sender.transfer(amount);
        // Emit withdraw event
        emit Withdrawal(spender, amount);
    }

    /**
     * @notice Deposit Flare from msg.sender to recipient and and mint WFLR ERC20.
     * @param recipient A payable address to receive Flare and minted WFLR.
     */
    function depositTo(address payable recipient) public payable {
        // Mint WFLR
        _mint(recipient, msg.value);
        // Transfer Flare to recipient
        recipient.transfer(msg.value);
        // Emit deposit event
        emit Deposit(recipient, msg.value);
    }

    /**
     * @notice Deposit Flare and mint WFLR ERC20.
     */
    function deposit() public payable {
        // Mint WFLR
        _mint(msg.sender, msg.value);
        // Emit deposit event
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw Flare and burn WFLR ERC20.
     * @param amount The amount to withdraw.
     */
    function withdraw(uint256 amount) public {
        // Burn WFLR tokens
        _burn(msg.sender, amount);
        // Send Flare to sender
        msg.sender.transfer(amount);
        // Emit withdrawal event
        emit Withdrawal(msg.sender, amount);
    }
}
