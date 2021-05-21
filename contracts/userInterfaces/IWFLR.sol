// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IWFLR {
    /**
     * @notice Deposit Flare and mint WFLR ERC20.
     */
    function deposit() external payable;

    /**
     * @notice Withdraw Flare and burn WFLR ERC20.
     * @param amount The amount to withdraw.
     */
    function withdraw(uint256 amount) external;
    
    /**
     * @notice Deposit Flare from msg.sender to recipient and and mint WFLR ERC20.
     * @param recipient A payable address to receive Flare and minted WFLR.
     */
    function depositTo(address payable recipient) external payable;
    
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
    function withdrawFrom(address owner, uint256 amount) external;
}