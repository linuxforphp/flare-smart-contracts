// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {CheckPointHistory} from "./CheckPointHistory.sol";
import {CheckPointsByAddress} from "./CheckPointsByAddress.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Vote power library
 * @notice A library to record delegate vote power balances by delegator 
 *  and delegatee.
 **/
library VotePower {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using SafeMath for uint256;

    /**
     * @dev `VotePowerState` is state structure used by this library to manage vote
     *  power amounts by delegator and it's delegates.
     */
    struct VotePowerState {
        // `votePowerByAddress` is the map that tracks the voting power balance
        //  of each address, by block.
        CheckPointsByAddress.CheckPointsByAddressState votePowerByAddress;
    }

    /**
     * @notice This modifier checks that both addresses are non-zero.
     * @param delegator A delegator address.
     * @param delegatee A delegatee address.
     */
    modifier addressesNotZero(address delegator, address delegatee) {
        // Both addresses cannot be zero
        assert(!(delegator == address(0) && delegatee == address(0)));
        _;
    }

    /**
     * @notice Burn vote power.
     * @param self A VotePowerState instance to manage.
     * @param owner The address of the vote power to be burned.
     * @param amount The amount of vote power to burn.
     */
    function _burn(
        VotePowerState storage self, 
        address owner, 
        uint256 amount) internal {

        // Shortcut
        if (amount == 0) {
            return;
        }

        // Cannot burn the zero address
        assert(owner != address(0));

        // Burn vote power for address
        self.votePowerByAddress.transmit(owner, address(0), amount);
    }

    /**
     * @notice Delegate vote power `amount` to `delegatee` address from `delegator` address.
     * @param delegator Delegator address 
     * @param delegatee Delegatee address
     * @param amount The amount of vote power to send from delegator to delegatee
     * @dev Amount recorded at the current block.
     **/
    function delegate(
        VotePowerState storage self, 
        address delegator, 
        address delegatee,
        uint256 amount) internal addressesNotZero(delegator, delegatee) {

        // Shortcut
        if (amount == 0) {
            return;
        }

        // Transmit vote power
        self.votePowerByAddress.transmit(delegator, delegatee, amount);
    }

    /**
     * @notice Mint vote power.
     * @param self A VotePowerState instance to manage.
     * @param owner The address owning the new vote power.
     * @param amount The amount of vote power to mint.
     */
    function _mint(
        VotePowerState storage self, 
        address owner, 
        uint256 amount) internal {

        // Shortcut
        if (amount == 0) {
            return;
        }

        // Cannot mint the zero address
        assert(owner != address(0));

        // Mint vote power for address
        self.votePowerByAddress.transmit(address(0), owner, amount);
    }

    /**
     * @notice Transmit current vote power `amount` `from` delegator `to` delegatee.
     * @param from Address of delegator.
     * @param to Address of delegatee.
     * @param amount Amount of vote power to transmit.
     */
    function transmit(
        VotePowerState storage self, 
        address from, 
        address to,
        uint256 amount
    ) internal addressesNotZero(from, to) {

        self.votePowerByAddress.transmit(from, to, amount);
    }

    /**
     * @notice Undelegate vote power `amount` from `delegatee` address 
     *  to `delegator` address
     * @param delegator Delegator address 
     * @param delegatee Delegatee address
     * @param amount The amount of vote power recovered by delegator from delegatee
     **/
    function undelegate(
        VotePowerState storage self, 
        address delegator, 
        address delegatee,
        uint256 amount) internal addressesNotZero(delegator, delegatee) {

        // Shortcut
        if (amount == 0) {
            return;
        }

        // Recover vote power
        self.votePowerByAddress.transmit(delegatee, delegator, amount);
    }

    /**
     * @notice Get the vote power of `who` at `blockNumber`.
     * @param self A VotePowerState instance to manage.
     * @param who Address to get vote power.
     * @param blockNumber Block number of the block to fetch vote power.
     * @return votePower The fetched vote power.
     */
    function votePowerOfAt(
        VotePowerState storage self, 
        address who, 
        uint256 blockNumber)
        internal view returns(uint256 votePower) {

        return self.votePowerByAddress.valueOfAt(who, blockNumber);
    }

    /**
     * @notice Get the current vote power of `who`.
     * @param self A VotePowerState instance to manage.
     * @param who Address to get vote power.
     * @return votePower The fetched vote power.
     */
    function votePowerOfAtNow(
        VotePowerState storage self, 
        address who)
        internal view returns(uint256 votePower) {

        return votePowerOfAt(self, who, block.number);
    }
}