// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./GovernanceAddressPointer.sol";

/**
 * @title Governed Base
 * @notice This abstract base class defines behaviors for a governed contract.
 * @dev This class is abstract so that specific behaviors can be defined for the constructor.
 *   Contracts should not be left ungoverned, but not all contract will have a constructor
 *   (for example those pre-defined in genesis).
 **/
abstract contract GovernedBase {
    struct TimelockedCall {
        uint256 allowedAfterTimestamp;
        bytes encodedCall;
    }
    
    address private initialGovernance;
    bool private initialised;
    
    GovernanceAddressPointer public governanceAddressPointer;
    uint64 public governanceTimelock;
    bool public productionMode;
    
    bool private executing;
    
    address public governanceExecutor;

    mapping(bytes4 => TimelockedCall) private timelockedCalls;
    
    event GovernanceCallTimelocked(bytes4 selector, uint256 allowedAfterTimestamp, bytes encodedCall);
    event TimelockedGovernanceCallExecuted(bytes4 selector, uint256 timestamp);
    
    event GovernanceInitialised(address initialGovernance);
    event GovernedProductionModeEntered(address governanceAddressPointer, uint256 timelock);
    
    modifier onlyGovernance {
        if (executing || !productionMode) {
            _beforeExecute();
            _;
        } else {
            _recordTimelockedCall(msg.data);
        }
    }
    
    modifier onlyImmediateGovernance () {
        _checkOnlyGovernance();
        _;
    }

    constructor(address _initialGovernance) {
        if (_initialGovernance != address(0)) {
            initialise(_initialGovernance);
        }
    }

    /**
     * @notice Execute the timelocked governance calls once the timelock period expires.
     * @dev Only executor can call this method.
     * @param _selector The method selector (only one timelocked call per method is stored).
     */
    function executeGovernanceCall(bytes4 _selector) external {
        require(msg.sender == governanceExecutor, "only executor");
        TimelockedCall storage call = timelockedCalls[_selector];
        require(call.allowedAfterTimestamp != 0, "timelock: invalid selector");
        require(block.timestamp >= call.allowedAfterTimestamp, "timelock: not allowed yet");
        bytes memory encodedCall = call.encodedCall;
        delete timelockedCalls[_selector];
        executing = true;
        //solhint-disable-next-line avoid-low-level-calls
        (bool success,) = address(this).call(encodedCall);
        executing = false;
        emit TimelockedGovernanceCallExecuted(_selector, block.timestamp);
        _passReturnOrRevert(success);
    }
    
    /**
     * @notice Set the address of the account that is allowed to execute the timelocked governance calls
     * once the timelock period expires.
     * It isn't very dangerous to allow for anyone to execute timelocked calls, but we reserve the right to
     * make sure the timing of the execution is under control.
     */
    function setGovernanceExecutor(address _executor) external onlyImmediateGovernance {
        governanceExecutor = _executor;
    }
    
    /**
     * Enter the production mode after all the initial governance settings have been set.
     * This enables timelocks and the governance is afterwards obtained by calling 
     * governanceAddressPointer.getGovernanceAddress(). 
     * @param _governanceAddressPointer The value for the governanceAddressPointer contract address.
     *    All governed contracts should have the same governanceAddressPointer.
     * @param _timelock The timelock to be used (the time before governance calls a method and it can be executed).
     */
    function switchToProductionMode(GovernanceAddressPointer _governanceAddressPointer, uint256 _timelock) external {
        _checkOnlyGovernance();
        require(!productionMode, "already in production mode");
        require(address(_governanceAddressPointer) != address(0) && 
            _governanceAddressPointer.getGovernanceAddress() != address(0),
            "invalid governance pointer");
        governanceAddressPointer = _governanceAddressPointer;
        governanceTimelock = SafeCast.toUint64(_timelock);
        initialGovernance = address(0);
        productionMode = true;
        emit GovernedProductionModeEntered(address(_governanceAddressPointer), _timelock);
    }

    /**
     * @notice Initialize the governance address if not first initialized.
     */
    function initialise(address _initialGovernance) public virtual {
        require(initialised == false, "initialised != false");
        initialised = true;
        initialGovernance = _initialGovernance;
        emit GovernanceInitialised(_initialGovernance);
    }
    
    /**
     * Returns the current effective governance address.
     */
    function governance() public view returns (address) {
        return productionMode ? governanceAddressPointer.getGovernanceAddress() : initialGovernance;
    }

    function _beforeExecute() private {
        if (executing) {
            // can only be run from executeGovernanceCall(), where we check that only executor can call
            // make sure nothing else gets executed, even in case of reentrancy
            executing = false;
        } else {
            // must be called with: deploymentFinished=false
            // must check governance in this case
            _checkOnlyGovernance();
        }
    }

    function _recordTimelockedCall(bytes calldata _data) private {
        _checkOnlyGovernance();
        bytes4 selector;
        //solhint-disable-next-line no-inline-assembly
        assembly {
            selector := calldataload(_data.offset)
        }
        uint256 allowedAt = block.timestamp + governanceTimelock;
        timelockedCalls[selector] = TimelockedCall({
            allowedAfterTimestamp: allowedAt,
            encodedCall: _data
        });
        emit GovernanceCallTimelocked(selector, allowedAt, _data);
    }
    
    function _checkOnlyGovernance() private view {
        require(msg.sender == governance(), "only governance");
    }
    
    function _passReturnOrRevert(bool _success) private pure {
        // pass exact return or revert data - needs to be done in assembly
        //solhint-disable-next-line no-inline-assembly
        assembly {
            let size := returndatasize()
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, size))
            returndatacopy(ptr, 0, size)
            if _success {
                return(ptr, size)
            }
            revert(ptr, size)
        }
    }
}
