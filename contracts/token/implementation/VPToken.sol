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
        string memory _name, 
        string memory _symbol) ERC20(_name, _symbol) {
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
    function balanceOfAt(address _owner, uint256 _blockNumber) 
    public view override(CheckPointable, IVPToken) returns (uint256) {
        return CheckPointable.balanceOfAt(_owner, _blockNumber);
    }
    
    /**
     * @notice Delegate `_bips` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(address _to, uint256 _bips) external override onlyPercent {
        // Get the current balance of sender and delegate by percentage _to recipient
        _delegateByPercentage(_to, balanceOf(_msgSender()), _bips);
    }

    /**
     * @notice Delegate `pct` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cummulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/    
    function delegateExplicit(address _to, uint256 _amount) external override onlyExplicit {
        _delegateByAmount(_to, balanceOf(_msgSender()), _amount);
    }

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(address _owner) public view override returns(uint256) {
        return _undelegatedVotePowerOf(_owner, balanceOf(_owner));
    }

    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) public view override returns (uint256) {
        return _undelegatedVotePowerOfAt(_owner, balanceOfAt(_owner, _blockNumber), _blockNumber);
    }

    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     **/
    function undelegateAll() external override onlyPercent {
        _undelegateAllByPercentage(balanceOf(_msgSender()));
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     */
    function undelegateAllExplicit(address[] memory _delegateAddresses) external override onlyExplicit {
        _undelegateAllByAmount(_delegateAddresses, balanceOf(_msgSender()));
    }
    
    /**
    * @notice Revoke all delegation from sender to `_who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    *    Block `_blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    */
    function revokeDelegationAt(address _who, uint256 _blockNumber) public override {
        _revokeDelegationAt(_who, balanceOfAt(_msgSender(), _blockNumber), _blockNumber);
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
        return _votePowerFromTo(_from, _to, balanceOf(_from));
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
        return _votePowerFromToAt(_from, _to, balanceOfAt(_from, _blockNumber), _blockNumber);
    }
    
    /**
     * @notice Get the current vote power.
     * @return The current vote power.
     */
    function votePower() public view override returns(uint256) {
        return totalSupply();
    }

    /**
    * @notice Get the vote power at block `_blockNumber`
    * @param _blockNumber The block number at which to fetch.
    * @return The vote power at the block.
    */
    function votePowerAt(uint256 _blockNumber) public view override returns(uint256) {
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

    // Update vote power and balance checkpoints before balances are modified. This is implemented
    // in the _beforeTokenTransfer hook, which is executed for _mint, _burn, and _transfer operations.
    function _beforeTokenTransfer(
        address _from, 
        address _to, 
        uint256 _amount) internal virtual override(ERC20) {
          
        ERC20._beforeTokenTransfer(_from, _to, _amount);

        if (_from == address(0)) {
            // mint new vote power
            _mintVotePower(_to, _amount);
            // mint checkpoint balance data for transferee
            _mintForAtNow(_to, _amount);
        } else if (_to == address(0)) {
            // burn vote power
            _burnVotePower(_from, balanceOf(_from), _amount);
            // burn checkpoint data for transferer
            _burnForAtNow(_from, _amount);
        } else {
            // transmit vote power _to receiver
            _transmitVotePower(_from, _to, balanceOf(_from), _amount);
            // transfer checkpoint balance data
            _transmitAtNow(_from, _to, _amount);
        }
    }
}