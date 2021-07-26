// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IWFlr {
    /**
     * @notice Deposit Flare and mint WFLR ERC20.
     */
    function deposit() external payable;

    /**
     * @notice Withdraw Flare and burn WFLR ERC20.
     * @param _amount The amount to withdraw.
     */
    function withdraw(uint256 _amount) external;
    
    /**
     * @notice Deposit Flare from msg.sender to recipient and and mint WFLR ERC20.
     * @param _recipient An address to receive minted WFLR.
     */
    function depositTo(address _recipient) external payable;
    
    /**
     * @notice Withdraw WFLR from an owner and send FLR to msg.sender given an allowance.
     * @param _owner An address spending the Flare tokens.
     * @param _amount The amount to spend.
     *
     * Requirements:
     *
     * - `_owner` must have a balance of at least `_amount`.
     * - the caller must have allowance for `_owners`'s tokens of at least
     * `_amount`.
     */
    function withdrawFrom(address _owner, uint256 _amount) external;
}
