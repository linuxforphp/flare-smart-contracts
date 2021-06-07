// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {PercentageDelegation} from "../lib/PercentageDelegation.sol";
import {ExplicitDelegation} from "../lib/ExplicitDelegation.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../../utils/implementation/SafePct.sol";
import {VotePower} from "../lib/VotePower.sol";
import {VotePowerCache} from "../lib/VotePowerCache.sol";
import {IIVPToken} from "../interface/IIVPToken.sol";

/**
 * @title Delegateable ERC20 behavior
 * @notice An ERC20 Delegateable behavior to delegate voting power
 *  of a token to delegates. This contract orchestrates interaction between
 *  managing a delegation and the vote power allocations that result.
 **/
abstract contract Delegatable is IIVPToken {
    using PercentageDelegation for PercentageDelegation.DelegationState;
    using ExplicitDelegation for ExplicitDelegation.DelegationState;
    using SafeMath for uint256;
    using SafePct for uint256;
    using VotePower for VotePower.VotePowerState;
    using VotePowerCache for VotePowerCache.CacheState;

    enum DelegationMode { 
        NOTSET, 
        PERCENTAGE, 
        AMOUNT
    }

    string constant private UNDELEGATED_VP_TOO_SMALL_MSG = 
        "Undelegated vote power too small";

    // Map that tracks delegation mode of each address.
    mapping(address => DelegationMode) private delegationModes;

    // `percentageDelegations` is the map that tracks the percentage voting power delegation of each address.
    // Explicit delegations are tracked directly through votePower.
    mapping(address => PercentageDelegation.DelegationState) private percentageDelegations;
    
    mapping(address => ExplicitDelegation.DelegationState) private explicitDelegations;

    // `votePower` tracks all voting power balances
    VotePower.VotePowerState private votePower;

    // `votePower` tracks all voting power balances
    VotePowerCache.CacheState private votePowerCache;

    /**
     * @notice (Un)Allocate `_owner` vote power of `_amount` across owner delegate
     *  vote power percentages.
     * @param _owner The address of the vote power owner.
     * @param _priorBalance The owner's balance before change.
     * @param _newBalance The owner's balance after change.
     */
    function _allocateVotePower(address _owner, uint256 _priorBalance, uint256 _newBalance) private {
        // Only proceed if we have a delegation by percentage
        if (delegationModes[_owner] == DelegationMode.PERCENTAGE) {
            // Get the voting delegation for the _owner
            PercentageDelegation.DelegationState storage delegation = percentageDelegations[_owner];
            // Iterate over the delegates
            (address[] memory delegates, uint256[] memory bipses) = delegation.getDelegations();
            for (uint256 i = 0; i < delegates.length; i++) {
                address delegate = delegates[i];
                // Compute the delegated vote power for the delegate
                uint256 priorValue = _priorBalance.mulDiv(bipses[i], PercentageDelegation.MAX_BIPS);
                uint256 newValue = _newBalance.mulDiv(bipses[i], PercentageDelegation.MAX_BIPS);
                // Compute new voting power
                if (newValue > priorValue) {
                    // increase (subtraction is safe as newValue > priorValue)
                    votePower.delegate(_owner, delegate, newValue - priorValue);
                } else {
                    // decrease (subtraction is safe as newValue < priorValue)
                    votePower.undelegate(_owner, delegate, priorValue - newValue);
                }
                emit Delegate(_owner, delegate, priorValue, newValue, block.number);
            }
        }
    }

    /**
     * @notice Burn `_amount` of vote power for `_owner`.
     * @param _owner The address of the _owner vote power to burn.
     * @param _ownerCurrentBalance The current token balance of the owner (which is their allocatable vote power).
     * @param _amount The amount of vote power to burn.
     */
    function _burnVotePower(address _owner, uint256 _ownerCurrentBalance, uint256 _amount) internal {
        // Is there enough unallocated VP _to burn if explicitly delegated?
        require(_isTransmittable(_owner, _ownerCurrentBalance, _amount), UNDELEGATED_VP_TOO_SMALL_MSG);
        // burn vote power
        votePower._burn(_owner, _amount);
        // Reduce newly burned vote power over delegates
        _allocateVotePower(_owner, _ownerCurrentBalance, _ownerCurrentBalance.sub(_amount));
    }

    /**
     * @notice Get whether `_owner` current delegation can be delegated by percentage.
     * @param _owner Address of delegation to check.
     * @return True if delegation can be delegated by percentage.
     */
    function _canDelegateByPct(address _owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = delegationModes[_owner];
        // Return true if delegation is safe _to store percents, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.PERCENTAGE;
    }

    /**
     * @notice Get whether `_owner` current delegation can be delegated by amount.
     * @param _owner Address of delegation to check.
     * @return True if delegation can be delegated by amount.
     */
    function _canDelegateByAmount(address _owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = delegationModes[_owner];
        // Return true if delegation is safe to store explicit amounts, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.AMOUNT;
    }

    /**
     * @notice Delegate `_amount` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _senderCurrentBalance The senders current balance (not their voting power)
     * @param _amount The amount of voting power to be delegated
     **/
    function _delegateByAmount(address _to, uint256 _senderCurrentBalance, uint256 _amount) internal virtual {
        require (_to != address(0), "Cannot delegate to zero");
        require (_to != msg.sender, "Cannot delegate to self");
        require (_canDelegateByAmount(msg.sender), "Cannot delegate by amount");
        
        // Get the vote power delegation for the sender
        ExplicitDelegation.DelegationState storage delegation = explicitDelegations[msg.sender];
        
        // the prior value
        uint256 priorAmount = delegation.getDelegatedValue(_to);
        
        // Delegate new power
        if (_amount < priorAmount) {
            // Prior amount is greater, just reduce the delegated amount.
            votePower.undelegate(msg.sender, _to, priorAmount - _amount);
        } else {
            // Is there enough undelegated vote power?
            uint256 availableAmount = _undelegatedVotePowerOf(msg.sender, _senderCurrentBalance).add(priorAmount);
            require(availableAmount >= _amount, UNDELEGATED_VP_TOO_SMALL_MSG);
            // Increase the delegated amount of vote power.
            votePower.delegate(msg.sender, _to, _amount - priorAmount);
        }
        
        // Add/replace delegate
        delegation.addReplaceDelegate(_to, _amount);

        // update mode if needed
        if (delegationModes[msg.sender] != DelegationMode.AMOUNT) {
            delegationModes[msg.sender] = DelegationMode.AMOUNT;
        }
        
        // emit event for delegation change
        emit Delegate(msg.sender, _to, priorAmount, _amount, block.number);
    }

    /**
     * @notice Delegate `_bips` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _senderCurrentBalance The senders current balance (not their voting power)
     * @param _bips The percentage of voting power in basis points (1/100 of 1 percent) to be delegated
     **/
    function _delegateByPercentage(address _to, uint256 _senderCurrentBalance, uint256 _bips) internal virtual {
        require (_to != address(0), "Cannot delegate to zero");
        require (_to != msg.sender, "Cannot delegate to self");
        require (_canDelegateByPct(msg.sender), "Cannot delegate by percentage");
        
        // Get the vote power delegation for the sender
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[msg.sender];

        // Get prior percent for delegate if exists
        uint256 priorBips = delegation.getDelegatedValue(_to);
        uint256 reverseVotePower = 0;
        uint256 newVotePower = 0;

        // Add/replace delegate
        delegation.addReplaceDelegate(_to, _bips);
        
        // First, back out old voting power percentage, if not zero
        if (priorBips != 0) {
            reverseVotePower = _senderCurrentBalance.mulDiv(priorBips, PercentageDelegation.MAX_BIPS);
        }

        // Calculate the new vote power
        if (_bips != 0) {
            newVotePower = _senderCurrentBalance.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        }

        // Delegate new power
        if (newVotePower < reverseVotePower) {
            votePower.undelegate(msg.sender, _to, reverseVotePower - newVotePower);
        } else {
            votePower.delegate(msg.sender, _to, newVotePower - reverseVotePower);
        }
        
        // update mode if needed
        if (delegationModes[msg.sender] != DelegationMode.PERCENTAGE) {
            delegationModes[msg.sender] = DelegationMode.PERCENTAGE;
        }

        // emit event for delegation change
        emit Delegate(msg.sender, _to, reverseVotePower, newVotePower, block.number);
    }

    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param _who The address to get delegation mode.
     * @return _delegationMode (NOTSET=0, PERCENTAGE=1, AMOUNT=2))
     */
    function delegationModeOf(address _who) public view override returns (uint256 _delegationMode) {
        return uint256(delegationModes[_who]);
    }

    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    ) public view override returns (
        address[] memory _delegateAddresses, 
        uint256[] memory _bips,
        uint256 _count,
        uint256 _delegationMode
    ) {
        DelegationMode mode = delegationModes[_owner];
        if (mode == DelegationMode.PERCENTAGE) {
            // Get the vote power delegation for the _owner
            (_delegateAddresses, _bips) = _percentageDelegatesOfAt(_owner, _blockNumber);
        } else if (mode == DelegationMode.NOTSET) {
            _delegateAddresses = new address[](0);
            _bips = new uint256[](0);
        } else {
            revert ("delegatesOf does not work in AMOUNT delegation mode");
        }
        _count = _delegateAddresses.length;
        _delegationMode = delegationModeOf(_owner);
    }
    
    function _percentageDelegatesOfAt(
        address _owner,
        uint256 _blockNumber
    ) private view returns (
        address[] memory _delegateAddresses, 
        uint256[] memory _bips
    ) {
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_owner];
        address[] memory allDelegateAddresses;
        uint256[] memory allBips;
        (allDelegateAddresses, allBips) = delegation.getDelegationsAt(_blockNumber);
        // delete revoked addresses
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (votePowerCache.revokedFromToAt(_owner, allDelegateAddresses[i], _blockNumber)) {
                allBips[i] = 0;
            }
        }
        uint256 length = 0;
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (allBips[i] != 0) length++;
        }
        _delegateAddresses = new address[](length);
        _bips = new uint256[](length);
        uint256 destIndex = 0;
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (allBips[i] != 0) {
                _delegateAddresses[destIndex] = allDelegateAddresses[i];
                _bips[destIndex] = allBips[i];
                destIndex++;
            }
        }
    }

    /**
    * @notice Get the vote power delegation `_delegateAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(
        address _owner
    ) public view override returns (
        address[] memory _delegateAddresses, 
        uint256[] memory _bips,
        uint256 _count,
        uint256 _delegationMode
    ) {
        return delegatesOfAt(_owner, block.number);
    }

    /**
     * @notice Checks if enough undelegated vote power exists to allow a token
     *  transfer to occur if vote power is explicitly delegated.
     * @param _owner The address of transmittable vote power to check.
     * @param _ownerCurrentBalance The current balance of `_owner`.
     * @param _amount The amount to check.
     * @return True is `_amount` is transmittable.
     */
    function _isTransmittable(
        address _owner, 
        uint256 _ownerCurrentBalance, 
        uint256 _amount
    ) private view returns(bool) {
        // Only proceed if we have a delegation by _amount
        if (delegationModes[_owner] == DelegationMode.AMOUNT) {
            // Return true if there is enough vote power _to cover the transfer
            return _undelegatedVotePowerOf(_owner, _ownerCurrentBalance) >= _amount;
        } else {
            // Not delegated by _amount, so transfer always allowed
            return true;
        }
    }

    /**
     * @notice Mint `_amount` of vote power for `_owner`.
     * @param _owner The address of the owner to receive new vote power.
     * @param _amount The amount of vote power to mint.
     */
    function _mintVotePower(address _owner, uint256 _ownerCurrentBalance, uint256 _amount) internal {
        votePower._mint(_owner, _amount);
        // Allocate newly minted vote power over delegates
        _allocateVotePower(_owner, _ownerCurrentBalance, _ownerCurrentBalance.add(_amount));
    }
    
    /**
    * @notice Revoke the vote power of `_who` at block `_blockNumber`
    * @param _who The delegatee address of vote power to revoke.
    * @param _senderBalanceAt The sender's balance at the block to be revoked.
    * @param _blockNumber The block number at which to revoke.
    */
    function _revokeDelegationAt(address _who, uint256 _senderBalanceAt, uint256 _blockNumber) internal {
        require(_blockNumber < block.number, "Revoke is only for the past, use undelegate for the present");
        
        // Revoke vote power and get amount revoked
        uint256 votePowerRevoked = _votePowerFromToAtNoRevokeCheck(msg.sender, _who, _senderBalanceAt, _blockNumber);
        votePowerCache.revokeAt(votePower, msg.sender, _who, votePowerRevoked, _blockNumber);

        // Emit revoke event
        emit Revoke(msg.sender, _who, votePowerRevoked, _blockNumber);
    }

    /**
    * @notice Transmit `_amount` of vote power `_from` address `_to` address.
    * @param _from The address of the sender.
    * @param _to The address of the receiver.
    * @param _fromCurrentBalance The current token balance of the transmitter.
    * @param _toCurrentBalance The current token balance of the receiver.
    * @param _amount The amount of vote power to transmit.
    */
    function _transmitVotePower(
        address _from, 
        address _to, 
        uint256 _fromCurrentBalance, 
        uint256 _toCurrentBalance,
        uint256 _amount
    ) internal {
        // for PERCENTAGE delegation: reduce sender vote power allocations
        // revert with the same error as ERC20 in case transfer exceeds balance
        uint256 newFromBalance = _fromCurrentBalance.sub(_amount, "ERC20: transfer amount exceeds balance");
        _allocateVotePower(_from, _fromCurrentBalance, newFromBalance);
        // for AMOUNT delegation: transmit vote power _to receiver
        require(_isTransmittable(_from, _fromCurrentBalance, _amount), UNDELEGATED_VP_TOO_SMALL_MSG);
        votePower.transmit(_from, _to, _amount);
        // Allocate receivers new vote power according _to their delegates
        _allocateVotePower(_to, _toCurrentBalance, _toCurrentBalance.add(_amount));
    }

    /**
     * @notice Undelegate all vote power by percentage for `delegation` of `_who`.
     * @param _senderCurrentBalance The current balance of message sender.
     * precondition: delegationModes[_who] == DelegationMode.PERCENTAGE
     */
    function _undelegateAllByPercentage(
        uint256 _senderCurrentBalance
    ) internal {
        DelegationMode delegationMode = delegationModes[msg.sender];
        if (delegationMode == DelegationMode.NOTSET) return;
        require(delegationMode == DelegationMode.PERCENTAGE,
            "undelegateAll can only be used in percentage delegation mode");
            
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[msg.sender];
        
        // Iterate over the delegates
        (address[] memory delegates, uint256[] memory _bips) = delegation.getDelegations();
        for (uint256 i = 0; i < delegates.length; i++) {
            // Compute vote power to be reversed for the delegate
            uint256 reverseVotePower = _senderCurrentBalance.mulDiv(_bips[i], PercentageDelegation.MAX_BIPS);
            // Transmit vote power back to _owner
            votePower.undelegate(msg.sender, delegates[i], reverseVotePower);
            // Emit vote power reversal event
            emit Delegate(msg.sender, delegates[i], reverseVotePower, 0, block.number);
        }

        // Clear delegates
        delegation.clear();
    }

    /**
     * @notice Undelegate all vote power by amount delegates for `msg.sender`.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     */
    function _undelegateAllByAmount(
        address[] memory _delegateAddresses
    ) internal returns (uint256 _remainingDelegation) {
        DelegationMode delegationMode = delegationModes[msg.sender];
        if (delegationMode == DelegationMode.NOTSET) return 0;
        require(delegationMode == DelegationMode.AMOUNT,
            "undelegateAllExplicit can only be used in explicit delegation mode");
            
        ExplicitDelegation.DelegationState storage delegation = explicitDelegations[msg.sender];
        
        // Iterate over the delegates
        for (uint256 i = 0; i < _delegateAddresses.length; i++) {
            // Compute vote power _to be reversed for the delegate
            uint256 reverseVotePower = delegation.getDelegatedValue(_delegateAddresses[i]);
            // Transmit vote power back _to _owner
            votePower.undelegate(msg.sender, _delegateAddresses[i], reverseVotePower);
            delegation.addReplaceDelegate(_delegateAddresses[i], 0);
            // Emit vote power reversal event
            emit Delegate(msg.sender, _delegateAddresses[i], reverseVotePower, 0, block.number);
        }
        
        return delegation.getDelegatedTotal();
    }

    /**
     * @notice Get the total delegated vote power of `_owner` at some block.
     * @param _owner The address of owner to get delegated vote power.
     * @param _ownerBalanceAt The balance of the owner at that block (not their vote power).
     * @param _blockNumber The block number at which to fetch.
     * @return _votePower The total delegated vote power at block.
     */
    function _delegatedVotePowerOfAt(
        address _owner, 
        uint256 _ownerBalanceAt,
        uint256 _blockNumber
    ) internal view returns(uint256 _votePower) {
        // Get the vote power delegation for the _owner
        DelegationMode delegationMode = delegationModes[_owner];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.AMOUNT) {
            return explicitDelegations[_owner].getDelegatedTotalAt(_blockNumber);
        } else { // delegationMode == DelegationMode.PERCENTAGE
            return percentageDelegations[_owner].getDelegatedTotalAmountAt(_ownerBalanceAt, _blockNumber);
        }
    }

    /**
     * @notice Get the undelegated vote power of `_owner` at some block.
     * @param _owner The address of owner to get undelegated vote power.
     * @param _ownerBalanceAt The balance of the owner at that block (not their vote power).
     * @param _blockNumber The block number at which to fetch.
     * @return _votePower The undelegated vote power at block.
     */
    function _undelegatedVotePowerOfAt(
        address _owner, 
        uint256 _ownerBalanceAt,
        uint256 _blockNumber
    ) internal view returns(uint256 _votePower) {
        // Return the current balance less delegations or zero if negative
        uint256 delegated = _delegatedVotePowerOfAt(_owner, _ownerBalanceAt, _blockNumber);
        bool overflow;
        uint256 result;
        (overflow, result) = _ownerBalanceAt.trySub(delegated);
        return result.add(votePowerCache.revokedTotalFromAt(_owner, _blockNumber));
    }

    /**
     * @notice Get the undelegated vote power of `_owner`.
     * @param _owner The address of owner to get undelegated vote power.
     * @param _ownerCurrentBalance The current balance of the owner (not their vote power).
     * @return _votePower The undelegated vote power.
     */
    function _undelegatedVotePowerOf(
        address _owner, 
        uint256 _ownerCurrentBalance
    ) internal view returns(uint256 _votePower) {
        return _undelegatedVotePowerOfAt(_owner, _ownerCurrentBalance, block.number);
    }
    
    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromTo(
        address _from, 
        address _to, 
        uint256 _currentFromBalance
    ) internal view returns(uint256 _votePower) {
        // no need for revocation check at current block
        return _votePowerFromToAtNoRevokeCheck(_from, _to, _currentFromBalance, block.number);
    }

    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _fromBalanceAt From's balance at the block `_blockNumber`.
    * @param _blockNumber The block number at which to fetch.
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _fromBalanceAt, 
        uint256 _blockNumber
    ) internal view returns(uint256 _votePower) {
        // if revoked, return 0
        if (votePowerCache.revokedFromToAt(_from, _to, _blockNumber)) return 0;
        return _votePowerFromToAtNoRevokeCheck(_from, _to, _fromBalanceAt, _blockNumber);
    }

    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    *   Private use only - ignores revocations.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _fromBalanceAt From's balance at the block `_blockNumber`.
    * @param _blockNumber The block number at which to fetch.
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromToAtNoRevokeCheck(
        address _from, 
        address _to, 
        uint256 _fromBalanceAt, 
        uint256 _blockNumber
    ) private view returns(uint256 _votePower) {
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.PERCENTAGE) {
            uint256 _bips = percentageDelegations[_from].getDelegatedValueAt(_to, _blockNumber);
            return _fromBalanceAt.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        } else { // delegationMode == DelegationMode.AMOUNT
            return explicitDelegations[_from].getDelegatedValueAt(_to, _blockNumber);
        }
    }

    /**
     * @notice Get the current vote power of `_who`.
     * @param _who The address to get voting power.
     * @return Current vote power of `_who`.
     */
    function votePowerOf(address _who) public view override returns(uint256) {
        return votePower.votePowerOfAtNow(_who);
    }

    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAt(address _who, uint256 _blockNumber) public view override returns(uint256) {
        // read cached value for past blocks to respect revocations (and possibly get a cache speedup)
        if (_blockNumber < block.number) {
            return votePowerCache.valueOfAtReadonly(votePower, _who, _blockNumber);
        } else {
            return votePower.votePowerOfAtNow(_who);
        }
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    *   Reads/updates cache and upholds revocations.
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _who, uint256 _blockNumber) public override returns(uint256) {
        require(_blockNumber < block.number, "Can only be used for past blocks");
        return votePowerCache.valueOfAt(votePower, _who, _blockNumber);
    }
}
