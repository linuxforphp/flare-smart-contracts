// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {Delegation} from "../lib/Delegation.sol";
import {IDelegatable} from "../IDelegatable.sol";
import {IVotePower} from "../IVotePower.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../lib/SafePct.sol";
import {VotePower} from "../lib/VotePower.sol";

/**
 * @title Delegateable ERC20 behavior
 * @notice An ERC20 Delegateable behavior to delegate voting power
 *  of a token to delegates. This contract orchestrates interaction between
 *  managing a delegation and the vote power allocations that result.
 **/
abstract contract Delegatable is IDelegatable, IVotePower {
    using Delegation for Delegation.DelegationState;
    using SafeMath for uint256;
    using SafePct for uint256;
    using VotePower for VotePower.VotePowerState;

    string constant private UNDELEGATED_VP_TOO_SMALL_MSG = 
        "Undelegated vote power too small";

    // `_delegations` is the map that tracks the voting power delegation of each 
    //  address.
    mapping (address => Delegation.DelegationState) private _delegations;

    // `_votePower` tracks all voting power balances
    VotePower.VotePowerState private _votePower;

    /**
     * @notice (Un)Allocate `owner` vote power of `amount` across owner delegate
     *  vote power percentages.
     * @param owner The address of the vote power owner.
     * @param amount The amount of vote power to allocate.
     * @param increase If true, allocation is from owner to delegation. If false, allocation
     *  is from delegation to owner.
     */
    function _allocateVotePower(address owner, uint256 amount, bool increase) private {
        // Get the voting delegation for the owner
        Delegation.DelegationState storage delegation = _delegations[owner];

        // Only proceed if we have a delegation by percentage
        if (delegation.getDelegationMode() == Delegation.DelegationMode.PERCENTAGE) {
            // Iterate over the delegates
            for (uint i = 0; i < delegation.getDelegateCount(); i++) {      // Permissive use: length capped
                // Get the delegate address and their allocation
                (address delegate, uint256 bips) = delegation.getDelegateAt(i);
                // Compute the delegated vote power for the delegate
                uint256 toAllocate = amount.mulDiv(bips, Delegation.MAX_BIPS);
                // Compute new voting power
                if (increase) {
                    // delegte
                    _votePower.delegate(owner, delegate, toAllocate);
                    // Emit delegate event for allocated vote power
                    emit Delegate(owner, delegate, toAllocate, block.number);
                } else {
                    // undelegate
                    _votePower.undelegate(owner, delegate, toAllocate);
                    // Emit delegate event for vote power reversal
                    emit Delegate(delegate, owner, toAllocate, block.number);
                }
            }
        }
    }

    /**
     * @notice Burn `amount` of vote power for `owner`.
     * @param owner The address of the owner vote power to burn.
     * @param ownerCurrentBalance The current token balance of the owner (which is their allocatable vote power).
     * @param amount The amount of vote power to burn.
     */
    function _burnVotePower(address owner, uint256 ownerCurrentBalance, uint256 amount) internal {
        // Is there enough unallocated VP to burn if explicitly delegated?
        _isTransmittable(owner, ownerCurrentBalance, amount) ?
            // burn vote power
            _votePower._burn(owner, amount):
            revert(UNDELEGATED_VP_TOO_SMALL_MSG);
        // Reduce newly burned vote power over delegates
        _allocateVotePower(owner, amount, false);
    }

    /**
     * @notice Get whether `owner` current delegation can be delegated by percentage.
     * @param owner Address of delegation to check.
     * @return True if delegation can be delegated by percentage.
     */
    function _canDelegateByPct(address owner) internal view returns(bool) {
        // Get the vote power delegation for the sender
        Delegation.DelegationState storage delegation;
        delegation = _delegations[owner];
        // Get the delegation mode.
        Delegation.DelegationMode delegationMode = delegation.getDelegationMode();
        // Return true if delegation is safe to store percents, which can also
        // apply if there is not delegation mode set.
        return delegationMode == Delegation.DelegationMode.NOTSET ||
            delegationMode == Delegation.DelegationMode.PERCENTAGE ?
            true :
            false;
    }

    /**
     * @notice Get whether `owner` current delegation can be delegated by amount.
     * @param owner Address of delegation to check.
     * @return True if delegation can be delegated by amount.
     */
    function _canDelegateByAmount(address owner) internal view returns(bool) {
        // Get the vote power delegation for the sender
        Delegation.DelegationState storage delegation;
        delegation = _delegations[owner];
        // Get the delegation mode.
        Delegation.DelegationMode delegationMode = delegation.getDelegationMode();
        // Return true if delegation is safe to store amounts, which can also
        // apply if there is not delegation mode set.
        return delegationMode == Delegation.DelegationMode.NOTSET ||
            delegationMode == Delegation.DelegationMode.AMOUNT ?
            true :
            false;
    }

    /**
     * @notice Delegate `amount` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param senderCurrentBalance The senders current balance (not their voting power)
     * @param amount The amount of voting power to be delegated
     **/
    function _delegateByAmount(address to, uint256 senderCurrentBalance, uint256 amount) internal virtual {      
        // Get the vote power delegation for the sender
        Delegation.DelegationState storage delegation;
        delegation = _delegations[msg.sender];

        // Find if delegate may already exist
        (bool found, uint256 oldAmount) = delegation.tryFindDelegate(to);
        if (found) {
            // The delegate was found. Back out old delegated amount.
            _votePower.undelegate(msg.sender, to, oldAmount);
            // Emit delegate event reversing currently delegated vote power
            emit Delegate(to, msg.sender, oldAmount, block.number);
        }

        // Add/replace delegate
        delegation.addReplaceDelegateByAmount(to, amount);

        // Is there enough undelegated vote power?
        require(_undelegatedVotePowerOf(msg.sender, senderCurrentBalance) >= amount, 
            UNDELEGATED_VP_TOO_SMALL_MSG);

        // Update vote power
        _votePower.delegate(msg.sender, to, amount);

        // Emit delegate event for newly delegated vote power
        emit Delegate(msg.sender, to, amount, block.number);
    }

    /**
     * @notice Delegate `bips` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param senderCurrentBalance The senders current balance (not their voting power)
     * @param bips The percentage of voting power in basis points (1/100 of 1 percent) to be delegated
     **/
    function _delegateByPercentage(address to, uint256 senderCurrentBalance, uint16 bips) internal virtual {
        // Get the vote power delegation for the sender
        Delegation.DelegationState storage delegation;
        delegation = _delegations[msg.sender];

        // Get prior percent for delegate if exists
        (bool found, uint256 priorBips) = delegation.tryFindDelegate(to);

        // Add/replace delegate
        delegation.addReplaceDelegateByPercent(to, bips);

        // First, back out old voting power percentage, if not zero
        if (found && priorBips != 0) {
            uint256 reverseVotePower = senderCurrentBalance.mulDiv(priorBips, Delegation.MAX_BIPS);
            _votePower.undelegate(msg.sender, to, reverseVotePower);
            // Emit delegate event reversing currently delegated vote power
            emit Delegate(to, msg.sender, reverseVotePower, block.number);
        }

        // Delegate new power
        uint256 newVotePower = senderCurrentBalance.mulDiv(bips, Delegation.MAX_BIPS);
        _votePower.delegate(msg.sender, to, newVotePower);

        // Emit delegate event for new vote delegated vote power
        emit Delegate(msg.sender, to, newVotePower, block.number);
    }

    /**
     * @notice Get the delegation mode for 'who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param who The address to get delegation mode.
     * @return delegationMode (NOTSET=0, PERCENTAGE=1, AMOUNT=2))
     */
    function delegationModeOf(address who) external view override returns (uint8 delegationMode) {
        return uint8(_delegations[who].getDelegationMode());
    }

    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    * @param owner The address to get delegations.
    * @return delegateAddresses Positional delegationAddress array of delegation addresses.
    * @return amountOrBips Positional amountOrBips array of delegation percents specified in 
    *  basis points (1/100 or 1 percent), or explicit vote power delegation amounts depending on `delegationMode`.
    * @return count The number of delegates.
    * @return delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(address owner) public view override 
        returns (
            address[] memory delegateAddresses, 
            uint256[] memory amountOrBips,
            uint256 count,
            uint8 delegationMode) {

        // Get the vote power delegation for the owner
        Delegation.DelegationState storage delegation;
        delegation = _delegations[owner];

        Delegation.DelegationMode mode = delegation.getDelegationMode();
        count = delegation.getDelegateCount();

        // Allocate array sizes
        delegateAddresses = new address[](count);
        amountOrBips = new uint256[](count);

        // Spin through all delegates
        for (uint i = 0; i < count; i++) {         // Permissive use: length capped
            (address delegate, uint256 fetchedAmountOrBips) = delegation.getDelegateAt(i);
            delegateAddresses[i] = delegate;
            if (mode == Delegation.DelegationMode.PERCENTAGE) {
                amountOrBips[i] = uint16(fetchedAmountOrBips);
            } else {
                amountOrBips[i] = fetchedAmountOrBips;
            }
        }

        delegationMode = uint8(mode);
    }

    /**
     * @notice Checks if enough undelegated vote power exists to allow a token
     *  transfer to occur if vote power is explicitly delegated.
     * @param owner The address of transmittable vote power to check.
     * @param ownerCurrentBalance The current balance of `owner`.
     * @param amount The amount to check.
     * @return True is `amount` is transmittable.
     */
    function _isTransmittable(
        address owner, 
        uint256 ownerCurrentBalance, 
        uint256 amount) private view returns(bool) {

        // Get the voting delegation for the owner
        Delegation.DelegationState storage delegation = _delegations[owner];
        // Only proceed if we have a delegation by amount
        if (delegation.getDelegationMode() == Delegation.DelegationMode.AMOUNT) {
            // Return true if there is enough vote power to cover the transfer
            return _undelegatedVotePowerOf(owner, ownerCurrentBalance) >= amount;
        } else {
            // Not delegated by amount, so transfer always allowed
            return true;
        }
    }

    /**
     * @notice Mint `amount` of vote power for `owner`.
     * @param owner The address to the owner to receive new vote power.
     * @param amount The amount of vote power to mint.
     */
    function _mintVotePower(address owner, uint256 amount) internal {
        _votePower._mint(owner, amount);
        // Allocate newly minted vote power over delegates
        _allocateVotePower(owner, amount, true);
    }
    
    /**
    * @notice Revoke the vote power of `who` at block `blockNumber`
    * @param who The delegatee address of vote power to revoke.
    * @param blockNumber The block number at which to fetch.
    */
    function revokeDelegationAt(address who, uint blockNumber) external override {
        // Revoke vote power and get amount revoked
        uint256 votePowerRevoked = _votePower.revokeAt(msg.sender, who, blockNumber);

        // Emit revoke event
        emit Revoke(msg.sender, who, votePowerRevoked, blockNumber);
    }

    /**
    * @notice Transmit `amount` of vote power `from` address `to` address.
    * @param from The address of the sender.
    * @param to The address of the receiver.
    * @param fromCurrentBalance The current token balance of the transmitter.
    * @param amount The amount of vote power to transmit.
    */
    function _transmitVotePower(
        address from, 
        address to, 
        uint256 fromCurrentBalance, 
        uint256 amount) internal {

        // reduce sender vote power allocations
        _allocateVotePower(from, amount, false);
        // transmit vote power to receiver
        _isTransmittable(from, fromCurrentBalance, amount) ?
            _votePower.transmit(from, to, amount) :
            revert(UNDELEGATED_VP_TOO_SMALL_MSG);
        // Allocate receivers new vote power according to their delegates
        _allocateVotePower(to, amount, true);
    }

    /**
     * @notice Undelegate all vote power delegates for `msg.sender`.
     * @param senderCurrentBalance The current balance of `who`.
     */
    function _undelegateAll(uint256 senderCurrentBalance) internal virtual {
        // Get the vote power delegation for the sender
        Delegation.DelegationState storage delegation;
        delegation = _delegations[msg.sender];

        if (delegation.getDelegationMode() == Delegation.DelegationMode.PERCENTAGE) {
            _undelegateAllByPercentage(delegation, msg.sender, senderCurrentBalance);
        } else if (delegation.getDelegationMode() == Delegation.DelegationMode.AMOUNT) {
            _undelegateAllByAmount(delegation, msg.sender, senderCurrentBalance);
        } else if (delegation.getDelegationMode() == Delegation.DelegationMode.NOTSET) {
            // Nothing to do
        } else {
            // Should not happen
            assert(false);
        }
    }

    /**
     * @notice Undelegate all vote power by amount for `delegation` of `who`.
     * @param delegation The delegation of `who`.
     * @param who The address of the delegation owner to undelegate.
     * @param senderCurrentBalance The current balance of `who`.
     */
    function _undelegateAllByAmount(
        Delegation.DelegationState storage delegation, 
        address who,
        uint256 senderCurrentBalance) internal {

        // Shortcut
        if (delegation.getDelegationMode() == Delegation.DelegationMode.NOTSET) {
            return;
        }
        
        assert(delegation.getDelegationMode() == Delegation.DelegationMode.AMOUNT);

        // Iterate over the delegates
        for (uint i = 0; i < delegation.getDelegateCount(); i++) {      // Permissive use: length capped
            (address delegate, uint256 amount) = delegation.getDelegateAt(i);
            // Transmit vote power back to owner
            _votePower.undelegate(who, delegate, amount);
            // Emit vote power reversal event
            emit Delegate(delegate, who, amount, block.number);
        }

        // Sanity check: Owner vote power should equal current balance
        assert(votePowerOf(who) == senderCurrentBalance);

        // Clear delegates
        delegation.clear();
    }

    /**
     * @notice Undelegate all vote power by percentage for `delegation` of `who`.
     * @param delegation The delegation of `who`.
     * @param who The address of the delegation owner to undelegate.
     * @param senderCurrentBalance The current balance of `who`.
     */
    function _undelegateAllByPercentage(
        Delegation.DelegationState storage delegation, 
        address who,
        uint256 senderCurrentBalance) internal {

        // Shortcut
        if (delegation.getDelegationMode() == Delegation.DelegationMode.NOTSET) {
            return;
        }

        assert(delegation.getDelegationMode() == Delegation.DelegationMode.PERCENTAGE);

        // Iterate over the delegates
        for (uint i = 0; i < delegation.getDelegateCount(); i++) {      // Permissive use: length capped
            (address delegate, uint256 bips) = delegation.getDelegateAt(i);
            // Compute vote power to be reversed for the delegate
            uint256 reverseVotePower = senderCurrentBalance.mulDiv(bips, Delegation.MAX_BIPS);
            // Transmit vote power back to owner
            _votePower.undelegate(who, delegate, reverseVotePower);
            // Emit vote power reversal event
            emit Delegate(delegate, who, reverseVotePower, block.number);
        }

        // Sanity check: Owner vote power should equal current balance
        assert(votePowerOf(who) == senderCurrentBalance);

        // Clear delegates
        delegation.clear();
    }

    /**
     * @notice Get the undelegated vote power of `owner`.
     * @param owner The address of owner to get undelegated vote power.
     * @param ownerCurrentBalance The current balance of the owner (not their vote power).
     * @return The undelegated vote power.
     */
    function _undelegatedVotePowerOf(
        address owner, 
        uint256 ownerCurrentBalance) internal view returns(uint256) {

        // Get the vote power delegation for the owner
        Delegation.DelegationState storage delegation = _delegations[owner];

        if (delegation.getDelegationMode() == Delegation.DelegationMode.NOTSET) {
            // Return the current balance as all vote power is undelegated
            return ownerCurrentBalance;
        } else if (delegation.getDelegationMode() == Delegation.DelegationMode.AMOUNT) {
            // Return the current balance less explicit delegations
            bool overflow;
            uint256 result;
            // Return zero if negative
            (overflow, result) = ownerCurrentBalance.trySub(delegation.getDelegateTotal());
            return result;
        } else if (delegation.getDelegationMode() == Delegation.DelegationMode.PERCENTAGE) {
            return ownerCurrentBalance.mulDiv(
                uint(Delegation.MAX_BIPS).sub(delegation.getDelegateTotal()), 
                Delegation.MAX_BIPS
            );
        } else {
            revert("Delegation mode not supported");
        }
    }
    
    /**
    * @notice Get current delegated vote power `from` delegator delegated `to` delegatee.
    * @param from Address of delegator
    * @param to Address of delegatee
    * @return The delegated vote power.
    */
    function votePowerFromTo(address from, address to) public view override returns(uint256) {
        return _votePower.votePowerFromToAtNow(from, to);
    }

    /**
    * @notice Get delegated the vote power `from` delegator delegated `to` delegatee at `blockNumber`.
    * @param from Address of delegator
    * @param to Address of delegatee
    * @param blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(address from, address to, uint blockNumber) public view override returns(uint256) {
        return _votePower.votePowerFromToAt(from, to, blockNumber);
    }

    /**
     * @notice Get the current vote power of `who`.
     * @param who The address to get voting power.
     * @return Current vote power of `who`.
     */
    function votePowerOf(address who) public view override returns(uint256) {
        return _votePower.votePowerOfAtNow(who);
    }

    /**
    * @notice Get the vote power of `who` at block `blockNumber`
    * @param who The address to get voting power.
    * @param blockNumber The block number at which to fetch.
    * @return Vote power of `who` at `blockNumber`.
    */
    function votePowerOfAt(address who, uint blockNumber) public view override returns(uint256) {
        return _votePower.votePowerOfAt(who, blockNumber);
    }
}