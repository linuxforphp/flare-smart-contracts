// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {PercentageDelegation} from "../lib/PercentageDelegation.sol";
import {ExplicitDelegation} from "../lib/ExplicitDelegation.sol";
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
    using PercentageDelegation for PercentageDelegation.DelegationState;
    using ExplicitDelegation for ExplicitDelegation.DelegationState;
    using SafeMath for uint256;
    using SafePct for uint256;
    using VotePower for VotePower.VotePowerState;

    enum DelegationMode { 
        NOTSET, 
        PERCENTAGE, 
        AMOUNT
    }

    string constant private UNDELEGATED_VP_TOO_SMALL_MSG = 
        "Undelegated vote power too small";

    // Map that tracks delegation mode of each address.
    mapping (address => DelegationMode) private _delegationMode;

    // `_percentageDelegations` is the map that tracks the percentage voting power delegation of each address.
    // Explicit delegations are tracked directly through _votePower.
    mapping (address => PercentageDelegation.DelegationState) private _percentageDelegations;
    
    mapping (address => ExplicitDelegation.DelegationState) private _explicitDelegations;

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
        // Only proceed if we have a delegation by percentage
        if (_delegationMode[owner] == DelegationMode.PERCENTAGE) {
            // Get the voting delegation for the owner
            PercentageDelegation.DelegationState storage delegation = _percentageDelegations[owner];
            // Iterate over the delegates
            (address[] memory delegates, uint256[] memory bipses) = delegation.getDelegations();
            for (uint i = 0; i < delegates.length; i++) {      // Permissive use: length capped
                address delegate = delegates[i];
                // Compute the delegated vote power for the delegate
                uint256 toAllocate = amount.mulDiv(bipses[i], PercentageDelegation.MAX_BIPS);
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
        require(_isTransmittable(owner, ownerCurrentBalance, amount), UNDELEGATED_VP_TOO_SMALL_MSG);
        // burn vote power
        _votePower._burn(owner, amount);
        // Reduce newly burned vote power over delegates
        _allocateVotePower(owner, amount, false);
    }

    /**
     * @notice Get whether `owner` current delegation can be delegated by percentage.
     * @param owner Address of delegation to check.
     * @return True if delegation can be delegated by percentage.
     */
    function _canDelegateByPct(address owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = _delegationMode[owner];
        // Return true if delegation is safe to store percents, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.PERCENTAGE;
    }

    /**
     * @notice Get whether `owner` current delegation can be delegated by amount.
     * @param owner Address of delegation to check.
     * @return True if delegation can be delegated by amount.
     */
    function _canDelegateByAmount(address owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = _delegationMode[owner];
        // Return true if delegation is safe to store explicit amounts, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.AMOUNT;
    }

    /**
     * @notice Delegate `amount` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param senderCurrentBalance The senders current balance (not their voting power)
     * @param amount The amount of voting power to be delegated
     **/
    function _delegateByAmount(address to, uint256 senderCurrentBalance, uint256 amount) internal virtual {      
        address from = msg.sender;
        
        require (_canDelegateByAmount(from), "Cannot delegate by amount");
        
        // Get the vote power delegation for the sender
        ExplicitDelegation.DelegationState storage delegation = _explicitDelegations[from];
        
        // Find if delegate may already exist
        uint256 oldAmount = _votePower.votePowerFromToAtNow(from, to);
        if (oldAmount > 0) {
            // The delegate was found. Back out old delegated amount.
            _votePower.undelegate(from, to, oldAmount);
            delegation.undelegate(oldAmount);
            // Emit delegate event reversing currently delegated vote power
            emit Delegate(to, from, oldAmount, block.number);
        }

        // Is there enough undelegated vote power?
        require(_undelegatedVotePowerOf(from, senderCurrentBalance) >= amount, 
            UNDELEGATED_VP_TOO_SMALL_MSG);

        // Update vote power and total
        _votePower.delegate(from, to, amount);
        delegation.delegate(amount);
        
        // update mode if needed
        if (_delegationMode[from] != DelegationMode.AMOUNT) {
            _delegationMode[from] = DelegationMode.AMOUNT;
        }

        // Emit delegate event for newly delegated vote power
        emit Delegate(from, to, amount, block.number);
    }

    /**
     * @notice Delegate `bips` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param senderCurrentBalance The senders current balance (not their voting power)
     * @param bips The percentage of voting power in basis points (1/100 of 1 percent) to be delegated
     **/
    function _delegateByPercentage(address to, uint256 senderCurrentBalance, uint16 bips) internal virtual {
        address from = msg.sender;
        
        require (_canDelegateByPct(from), "Cannot delegate by percentage");
        
        // Get the vote power delegation for the sender
        PercentageDelegation.DelegationState storage delegation = _percentageDelegations[from];

        // Get prior percent for delegate if exists
        (bool found, uint256 priorBips) = delegation.tryFindDelegate(to);

        // Add/replace delegate
        delegation.addReplaceDelegateByPercent(to, bips);

        // First, back out old voting power percentage, if not zero
        if (found && priorBips != 0) {
            uint256 reverseVotePower = senderCurrentBalance.mulDiv(priorBips, PercentageDelegation.MAX_BIPS);
            _votePower.undelegate(from, to, reverseVotePower);
            // Emit delegate event reversing currently delegated vote power
            emit Delegate(to, from, reverseVotePower, block.number);
        }

        // Delegate new power
        uint256 newVotePower = senderCurrentBalance.mulDiv(bips, PercentageDelegation.MAX_BIPS);
        _votePower.delegate(from, to, newVotePower);
        
        // update mode if needed
        if (_delegationMode[from] != DelegationMode.PERCENTAGE) {
            _delegationMode[from] = DelegationMode.PERCENTAGE;
        }

        // Emit delegate event for new vote delegated vote power
        emit Delegate(from, to, newVotePower, block.number);
    }

    /**
     * @notice Get the delegation mode for 'who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param who The address to get delegation mode.
     * @return delegationMode (NOTSET=0, PERCENTAGE=1, AMOUNT=2))
     */
    function delegationModeOf(address who) public view override returns (uint8 delegationMode) {
        return uint8(_delegationMode[who]);
    }

    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    * @param owner The address to get delegations.
    * @param blockNumber The block for which we want to know the delegations.
    * @return delegateAddresses Positional array of delegation addresses.
    * @return bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return count The number of delegates.
    * @return delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(
        address owner,
        uint256 blockNumber
    ) public view override returns (
        address[] memory delegateAddresses, 
        uint256[] memory bips,
        uint256 count,
        uint8 delegationMode
    ) {
        DelegationMode mode = _delegationMode[owner];
        if (mode == DelegationMode.PERCENTAGE) {
            // Get the vote power delegation for the owner
            PercentageDelegation.DelegationState storage delegation = _percentageDelegations[owner];
            (delegateAddresses, bips) = delegation.getDelegationsAt(blockNumber);
        } else if (mode == DelegationMode.NOTSET) {
            delegateAddresses = new address[](0);
            bips = new uint256[](0);
        } else {
            revert ("delegatesOf does not work in AMOUNT delegation mode");
        }
        count = delegateAddresses.length;
        delegationMode = delegationModeOf(owner);
    }

    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    * @param owner The address to get delegations.
    * @return delegateAddresses Positional array of delegation addresses.
    * @return bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return count The number of delegates.
    * @return delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(
        address owner
    ) public view override returns (
        address[] memory delegateAddresses, 
        uint256[] memory bips,
        uint256 count,
        uint8 delegationMode
    ) {
        return delegatesOfAt(owner, block.number);
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
        uint256 amount
    ) private view returns(bool) {
        // Only proceed if we have a delegation by amount
        if (_delegationMode[owner] == DelegationMode.AMOUNT) {
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
    * @param blockNumber The block number at which to revoke.
    */
    function revokeDelegationAt(address who, uint blockNumber) external override {
        // Revoke vote power and get amount revoked
        uint256 votePowerRevoked = _votePower.revokeAt(msg.sender, who, blockNumber);

        DelegationMode mode = _delegationMode[msg.sender];
        if (mode == DelegationMode.PERCENTAGE) {
            _percentageDelegations[msg.sender].addReplaceDelegateByPercentAt(who, 0, blockNumber);
        } else if (mode == DelegationMode.AMOUNT) {
            _explicitDelegations[msg.sender].undelegateAt(votePowerRevoked, blockNumber);
        }
        
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
        uint256 amount
    ) internal {
        // reduce sender vote power allocations
        _allocateVotePower(from, amount, false);
        // transmit vote power to receiver
        require(_isTransmittable(from, fromCurrentBalance, amount), UNDELEGATED_VP_TOO_SMALL_MSG);
        _votePower.transmit(from, to, amount);
        // Allocate receivers new vote power according to their delegates
        _allocateVotePower(to, amount, true);
    }

    /**
     * @notice Undelegate all vote power delegates for `msg.sender`.
     * @param senderCurrentBalance The current balance of `who`.
     */
    function _undelegateAll(uint256 senderCurrentBalance) internal virtual {
        DelegationMode delegationMode = _delegationMode[msg.sender];
        
        if (delegationMode == DelegationMode.PERCENTAGE) {
            PercentageDelegation.DelegationState storage delegation = _percentageDelegations[msg.sender];
            _undelegateAllByPercentage(delegation, msg.sender, senderCurrentBalance);
        } else if (delegationMode == DelegationMode.NOTSET) {
            // Nothing to do
        } else {
            revert("undelegateAll can only be used in percentage delegation mode");
        }
    }

    /**
     * @notice Undelegate all vote power by percentage for `delegation` of `who`.
     * @param delegation The delegation of `who`.
     * @param who The address of the delegation owner to undelegate.
     * @param senderCurrentBalance The current balance of `who`.
     * precondition: _delegationMode[who] == DelegationMode.PERCENTAGE
     */
    function _undelegateAllByPercentage(
        PercentageDelegation.DelegationState storage delegation, 
        address who,
        uint256 senderCurrentBalance
    ) private {
        // Iterate over the delegates
        (address[] memory delegates, uint256[] memory bips) = delegation.getDelegations();
        for (uint i = 0; i < delegates.length; i++) {      // Permissive use: length capped
            // Compute vote power to be reversed for the delegate
            uint256 reverseVotePower = senderCurrentBalance.mulDiv(bips[i], PercentageDelegation.MAX_BIPS);
            // Transmit vote power back to owner
            _votePower.undelegate(who, delegates[i], reverseVotePower);
            // Emit vote power reversal event
            emit Delegate(delegates[i], who, reverseVotePower, block.number);
        }

        // Sanity check: Owner vote power should equal current balance
        assert(votePowerOf(who) == senderCurrentBalance);

        // Clear delegates
        delegation.clear();
        
        // reset mode
        _delegationMode[who] = DelegationMode.NOTSET;
    }

    /**
     * @notice Undelegate all vote power delegates for `msg.sender`.
     * @param delegateAdresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @param senderCurrentBalance The current balance of `who`.
     */
    function _undelegateAllExplicit(address[] memory delegateAdresses, uint256 senderCurrentBalance) internal virtual {
        DelegationMode delegationMode = _delegationMode[msg.sender];
        
        if (delegationMode == DelegationMode.AMOUNT) {
            ExplicitDelegation.DelegationState storage delegation = _explicitDelegations[msg.sender];
            _undelegateAllByAmount(delegation, msg.sender, delegateAdresses, senderCurrentBalance);
        } else if (delegationMode == DelegationMode.NOTSET) {
            // Nothing to do
        } else {
            revert("undelegateAllExplicit can only be used in percentage delegation mode");
        }
    }

    /**
     * @notice Undelegate all vote power by amount for `delegation` of `who`.
     * @param delegation The delegation of `who`.
     * @param who The address of the delegation owner to undelegate.
     * @param delegateAdresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @param senderCurrentBalance The current balance of `who`.
     * precondition: _delegationMode[who] == DelegationMode.AMOUNT
     */
    function _undelegateAllByAmount(
        ExplicitDelegation.DelegationState storage delegation, 
        address who,
        address[] memory delegateAdresses,
        uint256 senderCurrentBalance
    ) private {
        // Iterate over the delegates
        for (uint i = 0; i < delegateAdresses.length; i++) {      // Permissive use: length capped
            // Compute vote power to be reversed for the delegate
            uint256 reverseVotePower = _votePower.votePowerFromToAtNow(who, delegateAdresses[i]);
            // Transmit vote power back to owner
            _votePower.undelegate(who, delegateAdresses[i], reverseVotePower);
            delegation.undelegate(reverseVotePower);
            // Emit vote power reversal event
            emit Delegate(delegateAdresses[i], who, reverseVotePower, block.number);
        }

        // all delegations cleared?
        if (delegation.getDelegateTotal() == 0) {
            // Sanity check: Owner vote power should equal current balance
            assert(votePowerOf(who) == senderCurrentBalance);
            // reset mode
            _delegationMode[who] = DelegationMode.NOTSET;
        }
    }

    /**
     * @notice Get the undelegated vote power of `owner` at some block.
     * @param owner The address of owner to get undelegated vote power.
     * @param ownerBalanceAt The balance of the owner at that block (not their vote power).
     * @param blockNumber The block number at which to fetch.
     * @return votePower The undelegated vote power at block.
     */
    function _undelegatedVotePowerOfAt(
        address owner, 
        uint256 ownerBalanceAt,
        uint256 blockNumber
    ) internal view returns(uint256 votePower) {
        // Get the vote power delegation for the owner
        DelegationMode delegationMode = _delegationMode[owner];
        if (delegationMode == DelegationMode.NOTSET) {
            // Return the current balance as all vote power is undelegated
            return ownerBalanceAt;
        } else if (delegationMode == DelegationMode.AMOUNT) {
            // Return the current balance less explicit delegations or zero if negative
            ExplicitDelegation.DelegationState storage delegation = _explicitDelegations[owner];
            bool overflow;
            uint256 result;
            (overflow, result) = ownerBalanceAt.trySub(delegation.getDelegateTotalAt(blockNumber));
            return result;
        } else if (delegationMode == DelegationMode.PERCENTAGE) {
            PercentageDelegation.DelegationState storage delegation = _percentageDelegations[owner];
            uint256 undelegatedBips = PercentageDelegation.MAX_BIPS.sub(delegation.getDelegateTotalAt(blockNumber));
            return ownerBalanceAt.mulDiv(undelegatedBips, PercentageDelegation.MAX_BIPS);
        } else {
            assert(false);
        }
    }

    /**
     * @notice Get the undelegated vote power of `owner`.
     * @param owner The address of owner to get undelegated vote power.
     * @param ownerCurrentBalance The current balance of the owner (not their vote power).
     * @return votePower The undelegated vote power.
     */
    function _undelegatedVotePowerOf(
        address owner, 
        uint256 ownerCurrentBalance
    ) internal view returns(uint256 votePower) {
        return _undelegatedVotePowerOfAt(owner, ownerCurrentBalance, block.number);
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