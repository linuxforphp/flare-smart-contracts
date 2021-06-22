// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointable} from "./CheckPointable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../../utils/implementation/SafePct.sol";
import {IVPToken} from "../../userInterfaces/IVPToken.sol";
import {IIVPToken} from "../interface/IIVPToken.sol";
import {IIVPContract} from "../interface/IIVPContract.sol";
import {Governed} from "../../governance/implementation/Governed.sol";

/**
 * @title Vote Power Token
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block.
 **/
contract VPToken is IIVPToken, ERC20, CheckPointable, Governed {
    using SafeMath for uint256;
    using SafePct for uint256;

    // the VPContract to use
    IIVPContract private vpContract;
    
    /**
     * When true, the argument to `setVpContract` must be a vpContract
     * with `isReplacement` set to `true`. To be used  for creating the correct VPContract.
     */
    bool public needsReplacementVPContract = false;
    
    constructor(
        address _governance,
        //slither-disable-next-line shadowing-local
        string memory _name, 
        //slither-disable-next-line shadowing-local
        string memory _symbol
    ) Governed(_governance) ERC20(_name, _symbol) {
    }
    
    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.name();
    }

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.symbol();
    }

    /**
     * @dev Should be compatible with ERC20 method
     */
    function decimals() public view override(ERC20, IVPToken) returns (uint8) {
        return ERC20.decimals();
    }

    /**
     * @notice Total amount of tokens at a specific `_blockNumber`.
     * @param _blockNumber The block number when the totalSupply is queried
     * @return The total amount of tokens at `_blockNumber`
     **/
    function totalSupplyAt(uint256 _blockNumber) public view override(CheckPointable, IVPToken) returns(uint256) {
        return CheckPointable.totalSupplyAt(_blockNumber);
    }

    /**
     * @dev Queries the token balance of `_owner` at a specific `_blockNumber`.
     * @param _owner The address from which the balance will be retrieved.
     * @param _blockNumber The block number when the balance is queried.
     * @return The balance at `_blockNumber`.
     **/
    function balanceOfAt(
        address _owner, 
        uint256 _blockNumber
    ) public view override(CheckPointable, IVPToken) returns (uint256) {
        return CheckPointable.balanceOfAt(_owner, _blockNumber);
    }
    
    /**
     * @notice Delegate `_bips` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(address _to, uint256 _bips) external override {
        // Get the current balance of sender and delegate by percentage _to recipient
        _checkVpContract().delegate(msg.sender, _to, balanceOf(msg.sender), _bips);
    }

    /**
     * @notice Delegate `pct` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/    
    function delegateExplicit(address _to, uint256 _amount) external override {
        _checkVpContract().delegateExplicit(msg.sender, _to, balanceOf(msg.sender), _amount);
    }

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(address _owner) external view override returns(uint256) {
        return _checkVpContract().undelegatedVotePowerOf(_owner, balanceOf(_owner));
    }

    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view override returns (uint256) {
        return _checkVpContract().undelegatedVotePowerOfAt(_owner, balanceOfAt(_owner, _blockNumber), _blockNumber);
    }

    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     **/
    function undelegateAll() external override {
        _checkVpContract().undelegateAll(msg.sender, balanceOf(msg.sender));
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return _remainingDelegation The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address[] memory _delegateAddresses
    ) external override returns (uint256 _remainingDelegation) {
        return _checkVpContract().undelegateAllExplicit(msg.sender, _delegateAddresses);
    }
    
    /**
    * @notice Revoke all delegation from sender to `_who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    *    Block `_blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    */
    function revokeDelegationAt(address _who, uint256 _blockNumber) public override {
        _checkVpContract().revokeDelegationAt(msg.sender, _who, balanceOfAt(msg.sender, _blockNumber), _blockNumber);
    }

    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return votePower The delegated vote power.
    */
    function votePowerFromTo(
        address _from, 
        address _to
    ) external view override returns(uint256) {
        return _checkVpContract().votePowerFromTo(_from, _to, balanceOf(_from));
    }
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _blockNumber
    ) external view override returns(uint256) {
        return _checkVpContract().votePowerFromToAt(_from, _to, balanceOfAt(_from, _blockNumber), _blockNumber);
    }
    
    /**
     * @notice Get the current vote power.
     * @return The current vote power.
     */
    function votePower() external view override returns(uint256) {
        return totalSupply();
    }

    /**
    * @notice Get the vote power at block `_blockNumber`
    * @param _blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAt(uint256 _blockNumber) external view override returns(uint256) {
        return totalSupplyAt(_blockNumber);
    }

    /**
    * @notice Get the vote power at block `_blockNumber` using cache.
    *   It tries _to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if _blockNumber is in the past, otherwise reverts.    
    * @param _blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAtCached(uint256 _blockNumber) public override returns(uint256) {
        return _totalSupplyAtCached(_blockNumber);
    }
    
    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value. Once the delegation mode is set, 
     *  it never changes, even if all delegations are removed.
     * @param _who The address to get delegation mode.
     * @return delegation mode: 0 = NOTSET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit)
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return _checkVpContract().delegationModeOf(_who);
    }


    /**
     * @notice Get the current vote power of `_owner`.
     * @param _owner The address to get voting power.
     * @return Current vote power of `_owner`.
     */
    function votePowerOf(address _owner) external view override returns(uint256) {
        return _checkVpContract().votePowerOf(_owner);
    }


    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAt(address _owner, uint256 _blockNumber) external view override returns(uint256) {
        return _checkVpContract().votePowerOfAt(_owner, _blockNumber);
    }
    
    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if _blockNumber is in the past, otherwise reverts.    
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _owner, uint256 _blockNumber) public override returns(uint256) {
        return _checkVpContract().votePowerOfAtCached(_owner, _blockNumber);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of `_who`. Returned in two separate positional arrays.
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
        return _checkVpContract().delegatesOf(_owner);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of `_who`. Returned in two separate positional arrays.
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
    ) external view override returns (
        address[] memory _delegateAddresses, 
        uint256[] memory _bips,
        uint256 _count,
        uint256 _delegationMode
    ) {
        return _checkVpContract().delegatesOfAt(_owner, _blockNumber);
    }

    // Update vote power and balance checkpoints before balances are modified. This is implemented
    // in the _beforeTokenTransfer hook, which is executed for _mint, _burn, and _transfer operations.
    function _beforeTokenTransfer(
        address _from, 
        address _to, 
        uint256 _amount
    ) internal virtual override(ERC20) {
        require(_from != _to, "Cannot transfer to self");
        
        // update vote powers
        IIVPContract vpc = vpContract;
        if (address(vpc) != address(0)) {
            vpc.updateAtTokenTransfer(_from, _to, balanceOf(_from), balanceOf(_to), _amount);
        } else if (!needsReplacementVPContract) {
            // transfers without vpcontract are allowed, but after they are made
            // any added vpcontract must have isReplacement set
            needsReplacementVPContract = true;
        }

        // update balance history
        _updateBalanceHistoryAtTransfer(_from, _to, _amount);
    }
    
    /**
     * Call from governance to set VpContract on token, e.g. 
     * `vpToken.setVpContract(new VPContract(address(vpToken)))`
     * VPContract must be set before any of the VPToken delegation or vote power methods are called, 
     * otherwise they will revert.
     * VPContract may only be set once.
     * @param _vpContract Vote power contract to be used by this token.
     */
    function setVpContract(IIVPContract _vpContract) external onlyGovernance {
        if (address(_vpContract) != address(0)) {
            require(address(_vpContract.ownerToken()) == address(this),
                "VPContract not owned by this token");
            require(!needsReplacementVPContract || _vpContract.isReplacement(),
                "VPContract not configured for replacement");
            // once a non-null vpcontract is set, every other has to have isReplacement flag set
            needsReplacementVPContract = true;
        }
        vpContract = _vpContract;
    }
    
    /**
     * Return vpContract, ensuring that it is not zero.
     */
    function _checkVpContract() internal view returns (IIVPContract) {
        IIVPContract vpc = vpContract;
        require(address(vpc) != address(0), "Missing VPContract on VPToken");
        return vpc;
    }
    
    /**
     * Return vpContract, may be zero.
     */
    function _getVpContract() internal view returns (IIVPContract) {
        return vpContract;
    }

    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override onlyGovernance {
        _setCleanupBlockNumber(_blockNumber);
        _checkVpContract().setCleanupBlockNumber(_blockNumber);
    }
}
