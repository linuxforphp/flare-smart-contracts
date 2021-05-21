// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {CheckPointable} from "./CheckPointable.sol";
import {Delegatable} from "./Delegatable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "../../lib/SafePct.sol";
import {IVPToken} from "../../userInterfaces/IVPToken.sol";

/**
 * @title Vote Power Token
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block.
 **/
contract VPToken is ERC20, CheckPointable, Delegatable {
    using SafeMath for uint256;
    using SafePct for uint256;

    string constant private ALREADY_EXPLICIT_MSG = "Already delegated explicitly";
    string constant private ALREADY_PERCENT_MSG = "Already delegated by percentage";

    constructor(
        string memory name_, 
        string memory symbol_) ERC20(name_, symbol_) {
    }
    
    modifier onlyPercent {
        // If a delegate cannot be added by percentage, revert.
        require(_canDelegateByPct(_msgSender()), ALREADY_EXPLICIT_MSG);
        _;
    }

    modifier onlyExplicit {
        // If a delegate cannot be added by explicit amount, revert.
        require(_canDelegateByAmount(_msgSender()), ALREADY_PERCENT_MSG);
        _;
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
     * @notice Total amount of tokens at a specific `blockNumber`.
     * @param blockNumber The block number when the totalSupply is queried
     * @return The total amount of tokens at `blockNumber`
     **/
    function totalSupplyAt(uint blockNumber) public view override(CheckPointable, IVPToken) returns(uint256) {
        return CheckPointable.totalSupplyAt(blockNumber);
    }

    /**
     * @dev Queries the token balance of `owner` at a specific `blockNumber`.
     * @param owner The address from which the balance will be retrieved.
     * @param blockNumber The block number when the balance is queried.
     * @return The balance at `blockNumber`.
     **/
    function balanceOfAt(address owner, uint blockNumber) 
    public view override(CheckPointable, IVPToken) returns (uint256) {
        return CheckPointable.balanceOfAt(owner, blockNumber);
    }
    
    /**
     * @notice Delegate `pct` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(address to, uint256 bips) external override onlyPercent {
        // Get the current balance of sender and delegate by percentage to recipient
        _delegateByPercentage(to, balanceOf(_msgSender()), bips);
    }

    /**
     * @notice Delegate `pct` of voting power to `to` from `msg.sender`
     * @param to The address of the recipient
     * @param amount An explicit vote power amount to be delegated.
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/    
    function delegateExplicit(address to, uint256 amount) external override onlyExplicit {
        _delegateByAmount(to, balanceOf(_msgSender()), amount);
    }

    /**
     * @notice Compute the current undelegated vote power of `owner`
     * @param owner The address to get undelegated voting power.
     * @return The unallocated vote power of `owner`
     */
    function undelegatedVotePowerOf(address owner) public view override returns(uint256) {
        return _undelegatedVotePowerOf(owner, balanceOf(owner));
    }

    /**
     * @notice Get the undelegated vote power of `owner` at given block.
     * @param owner The address to get undelegated voting power.
     * @param blockNumber The block number at which to fetch.
     * @return The unallocated vote power of `owner`
     */
    function undelegatedVotePowerOfAt(address owner, uint256 blockNumber) public view override returns (uint256) {
        return _undelegatedVotePowerOfAt(owner, balanceOfAt(owner, blockNumber), blockNumber);
    }

    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     **/
    function undelegateAll() external override onlyPercent {
        _undelegateAllByPercentage(balanceOf(_msgSender()));
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     * @param delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     */
    function undelegateAllExplicit(address[] memory delegateAddresses) external override onlyExplicit {
        _undelegateAllByAmount(delegateAddresses, balanceOf(_msgSender()));
    }
    
    /**
    * @notice Revoke all delegation from sender to `who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `blockNumber`.
    *    Block `blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    */
    function revokeDelegationAt(address who, uint blockNumber) public override {
        _revokeDelegationAt(who, balanceOfAt(_msgSender(), blockNumber), blockNumber);
    }

    /**
    * @notice Get current delegated vote power `from` delegator delegated `to` delegatee.
    * @param from Address of delegator
    * @param to Address of delegatee
    * @return votePower The delegated vote power.
    */
    function votePowerFromTo(address from, address to) external view override returns(uint256) {
        return _votePowerFromTo(from, to, balanceOf(from));
    }
    
    /**
    * @notice Get delegated the vote power `from` delegator delegated `to` delegatee at `blockNumber`.
    * @param from Address of delegator
    * @param to Address of delegatee
    * @param blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(address from, address to, uint blockNumber) external view override returns(uint256) {
        return _votePowerFromToAt(from, to, balanceOfAt(from, blockNumber), blockNumber);
    }
    
    /**
     * @notice Get the current vote power.
     * @return The current vote power.
     */
    function votePower() public view override returns(uint256) {
        return totalSupply();
    }

    /**
    * @notice Get the vote power at block `blockNumber`
    * @param blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAt(uint blockNumber) public view override returns(uint256) {
        return totalSupplyAt(blockNumber);
    }

    /**
    * @notice Get the vote power at block `blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if blockNumber is in the past, otherwise reverts.    
    * @param blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAtCached(uint blockNumber) public override returns(uint256) {
        return _totalSupplyAtCached(blockNumber);
    }

    // Update vote power and balance checkpoints before balances are modified. This is implemented
    // in the _beforeTokenTransfer hook, which is executed for _mint, _burn, and _transfer operations.
    function _beforeTokenTransfer(
        address from, 
        address to, 
        uint256 amount) internal virtual override(ERC20) {
          
        ERC20._beforeTokenTransfer(from, to, amount);

        if (from == address(0)) {
            // mint new vote power
            _mintVotePower(to, amount);
            // mint checkpoint balance data for transferee
            _mintForAtNow(to, amount);
        } else if (to == address(0)) {
            // burn vote power
            _burnVotePower(from, balanceOf(from), amount);
            // burn checkpoint data for transferer
            _burnForAtNow(from, amount);
        } else {
            // transmit vote power to receiver
            _transmitVotePower(from, to, balanceOf(from), amount);
            // transfer checkpoint balance data
            _transmitAtNow(from, to, amount);
        }
    }
}