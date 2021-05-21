// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVPToken is IERC20 {
    /* solhint-disable ordering */
    
    /**
     * Event triggered when an account delegates or undelegates another account 
     * (for undelegation, from and to will be switched).
     */
    event Delegate(address indexed from, address indexed to, uint votePower, uint blockNumber);
    
    /**
     * Event triggered only when account `delegator` revokes delegation to `delegatee`
     * for a single block in the past (typically the current vote block).
     */
    event Revoke(address indexed delegator, address indexed delegatee, uint votePower, uint blockNumber);
    
    
    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function decimals() external view returns (uint8);
    

    /**
     * @notice Total amount of tokens at a specific `blockNumber`.
     * @param blockNumber The block number when the totalSupply is queried
     * @return The total amount of tokens at `blockNumber`
     **/
    function totalSupplyAt(uint blockNumber) external view returns(uint256);

    /**
     * @dev Queries the token balance of `owner` at a specific `blockNumber`.
     * @param owner The address from which the balance will be retrieved.
     * @param blockNumber The block number when the balance is queried.
     * @return The balance at `blockNumber`.
     **/
    function balanceOfAt(address owner, uint blockNumber) external view returns (uint256);

    
    /**
     * @notice Get the current vote power.
     * @return The current vote power.
     */
    function votePower() external view returns(uint256);
    
    /**
    * @notice Get the vote power at block `blockNumber`
    * @param blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAt(uint blockNumber) external view returns(uint256);

    /**
     * @notice Get the current vote power of `owner`.
     * @param owner The address to get voting power.
     * @return Current vote power of `owner`.
     */
    function votePowerOf(address owner) external view returns(uint256);
    
    /**
    * @notice Get the vote power of `owner` at block `blockNumber`
    * @param owner The address to get voting power.
    * @param blockNumber The block number at which to fetch.
    * @return Vote power of `owner` at `blockNumber`.
    */
    function votePowerOfAt(address owner, uint256 blockNumber) external view returns(uint256);


    /**
     * @notice Delegate by percentage  `pct` of voting power to `to` from `msg.sender`.
     * @param to The address of the recipient
     * @param bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/
    function delegate(address to, uint256 bips) external;
    
    /**
     * @notice Explicitly delegate `amount` of voting power to `to` from `msg.sender`.
     * @param to The address of the recipient
     * @param amount An explicit vote power amount to be delegated.
     *   Not cummulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/    
    function delegateExplicit(address to, uint amount) external;

    /**
    * @notice Revoke all delegation from sender to `who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `blockNumber`.
    *    Block `blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    * @param who Address of the delegatee
    * @param blockNumber The block number at which to revoke delegation.
    */
    function revokeDelegationAt(address who, uint blockNumber) external;
    
    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     *    Can only be used with percentage delegation.
     *    Does not reset delegation mode back to NOTSET.
     **/
    function undelegateAll() external;
    
    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     *    Can only be used with explicit delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     */
    function undelegateAllExplicit(address[] memory delegateAddresses) external;

    /**
     * @notice Get the delegation mode for 'who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value. Once the delegation mode is set, 
     *  it never changes, even if all delegations are removed.
     * @param who The address to get delegation mode.
     * @return delegation mode: 0 = NOTSET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit)
     */
    function delegationModeOf(address who) external view returns(uint256);
        
    /**
    * @notice Get current delegated vote power `from` delegator delegated `to` delegatee.
    * @param from Address of delegator
    * @param to Address of delegatee
    * @return votePower The delegated vote power.
    */
    function votePowerFromTo(address from, address to) external view returns(uint256);
    
    /**
    * @notice Get delegated the vote power `from` delegator delegated `to` delegatee at `blockNumber`.
    * @param from Address of delegator
    * @param to Address of delegatee
    * @param blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(address from, address to, uint blockNumber) external view returns(uint256);
    
    /**
     * @notice Compute the current undelegated vote power of `owner`
     * @param owner The address to get undelegated voting power.
     * @return The unallocated vote power of `owner`
     */
    function undelegatedVotePowerOf(address owner) external view returns(uint256);
    
    /**
     * @notice Get the undelegated vote power of `owner` at given block.
     * @param owner The address to get undelegated voting power.
     * @param blockNumber The block number at which to fetch.
     * @return The unallocated vote power of `owner`
     */
    function undelegatedVotePowerOfAt(address owner, uint256 blockNumber) external view returns(uint256);
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of `who`. Returned in two separate positional arrays.
    * @param who The address to get delegations.
    * @return delegateAddresses Positional array of delegation addresses.
    * @return bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return count The number of delegates.
    * @return delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(address who) external view returns (
        address[] memory delegateAddresses,
        uint256[] memory bips,
        uint256 count, 
        uint256 delegationMode);
        
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of `who`. Returned in two separate positional arrays.
    * @param who The address to get delegations.
    * @param blockNumber The block for which we want to know the delegations.
    * @return delegateAddresses Positional array of delegation addresses.
    * @return bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return count The number of delegates.
    * @return delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(address who, uint256 blockNumber) external view returns (
        address[] memory delegateAddresses, 
        uint256[] memory bips, 
        uint256 count, 
        uint256 delegationMode);
}
