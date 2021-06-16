// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {Delegatable} from "./Delegatable.sol";
import {IIVPContract} from "../interface/IIVPContract.sol";

contract VPContract is IIVPContract, Delegatable {
    // The VPToken (or some other contract) that owns this VPContract.
    // All state changing methods may be called only from this address.
    // This is because original msg.sender is sent in `_from` parameter
    // and we must be sure that it cannot be faked by directly calling VPContract.
    address private ownerToken;
    
    string constant private ALREADY_EXPLICIT_MSG = "Already delegated explicitly";
    string constant private ALREADY_PERCENT_MSG = "Already delegated by percentage";

    /**
     * All external methods in VPContract can only be executed by the owner token.
     */
    modifier onlyOwnerToken {
        require(msg.sender == ownerToken);
        _;
    }

    modifier onlyPercent(address sender) {
        // If a delegate cannot be added by percentage, revert.
        require(_canDelegateByPct(sender), ALREADY_EXPLICIT_MSG);
        _;
    }

    modifier onlyExplicit(address sender) {
        // If a delegate cannot be added by explicit amount, revert.
        require(_canDelegateByAmount(sender), ALREADY_PERCENT_MSG);
        _;
    }

    /**
     * Construct VPContract for given VPToken.
     */
    constructor(address _ownerToken) {
        require(_ownerToken != address(0), "VPContract must belong to a VPToken");
        ownerToken = _ownerToken;
    }
    
    /**
     * Update vote powers when tokens are transfered.
     * Also update delegated vote powers for percentage delegation
     * and check for enough funds for explicit delegations.
     **/
    function updateAtTokenTransfer(
        address _from, 
        address _to, 
        uint256 _fromBalance,
        uint256 _toBalance,
        uint256 _amount
    ) external override onlyOwnerToken {
        if (_from == address(0)) {
            // mint new vote power
            _mintVotePower(_to, _toBalance, _amount);
        } else if (_to == address(0)) {
            // burn vote power
            _burnVotePower(_from, _fromBalance, _amount);
        } else {
            // transmit vote power _to receiver
            _transmitVotePower(_from, _to, _fromBalance, _toBalance, _amount);
        }
    }

    /**
     * @notice Delegate `_bips` percentage of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint256 _bips
    ) external override onlyOwnerToken onlyPercent(_from) {
        _delegateByPercentage(_from, _to, _balance, _bips);
    }
    
    /**
     * @notice Explicitly delegate `_amount` of voting power to `_to` from `_from`.
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cummulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/    
    function delegateExplicit(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint _amount
    ) external override onlyOwnerToken onlyExplicit(_from) {
        _delegateByAmount(_from, _to, _balance, _amount);
    }

    /**
     * @notice Revoke all delegation from sender to `_who` at given block. 
     *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
     *    Block `_blockNumber` must be in the past. 
     *    This method should be used only to prevent rogue delegate voting in the current voting block.
     *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
     * @param _from The address of the delegator
     * @param _who Address of the delegatee
     * @param _balance The delegator's current balance
     * @param _blockNumber The block number at which to revoke delegation.
     **/
    function revokeDelegationAt(
        address _from, 
        address _who, 
        uint256 _balance,
        uint _blockNumber
    ) external override onlyOwnerToken {
        _revokeDelegationAt(_from, _who, _balance, _blockNumber);
    }

    /**
     * @notice Undelegate all voting power for delegates of `_from`
     *    Can only be used with percentage delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     **/
    function undelegateAll(
        address _from,
        uint256 _balance
    ) external override onlyOwnerToken onlyPercent(_from) {
        _undelegateAllByPercentage(_from, _balance);
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `_from`.
     *    Can only be used with explicit delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address _from, 
        address[] memory _delegateAddresses
    ) external override onlyOwnerToken onlyExplicit(_from) returns (uint256) {
        return _undelegateAllByAmount(_from, _delegateAddresses);
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    *   Reads/updates cache and upholds revocations.
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _who, uint256 _blockNumber) external override returns(uint256) {
        return _votePowerOfAtCached(_who, _blockNumber);
    }
    
    /**
     * @notice Get the current vote power of `_who`.
     * @param _who The address to get voting power.
     * @return Current vote power of `_who`.
     */
    function votePowerOf(address _who) external view override returns(uint256) {
        return _votePowerOf(_who);
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAt(address _who, uint256 _blockNumber) external view override returns(uint256) {
        return _votePowerOfAt(_who, _blockNumber);
    }
    
    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @return The delegated vote power.
    */
    function votePowerFromTo(
        address _from, 
        address _to, 
        uint256 _balance
    ) external view override returns (uint256) {
        return _votePowerFromTo(_from, _to, _balance);
    }
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _balance,
        uint _blockNumber
    ) external view override returns (uint256) {
        return _votePowerFromToAt(_from, _to, _balance, _blockNumber);
    }
    
    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param _who The address to get delegation mode.
     * @return Delegation mode (NOTSET=0, PERCENTAGE=1, AMOUNT=2))
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return uint256(_delegationModeOf(_who));
    }

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @param _balance Owner's current balance
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(
        address _owner,
        uint256 _balance
    ) external view override returns (uint256) {
        return _undelegatedVotePowerOf(_owner, _balance);
    }
    
    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The undelegated vote power of `_owner` (= owner's own balance minus all delegations from owner)
     */
    function undelegatedVotePowerOfAt(
        address _owner, 
        uint256 _balance,
        uint256 _blockNumber
    ) external view override returns (uint256) {
        return _undelegatedVotePowerOfAt(_owner, _balance, _blockNumber);
    }

    /**
    * @notice Get the vote power delegation `_delegateAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    *  Also returns the count of delegates and delegation mode.
    * @param _owner The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(
        address _owner
    ) external view override returns (
        address[] memory _delegateAddresses, 
        uint256[] memory _bips,
        uint256 _count,
        uint256 _delegationMode
    ) {
        return delegatesOfAt(_owner, block.number);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of an `_owner`. Returned in two separate positional arrays.
    *  Also returns the count of delegates and delegation mode.
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
        DelegationMode mode = _delegationModeOf(_owner);
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
        _delegationMode = uint256(mode);
    }
}