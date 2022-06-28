// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";


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
    
    address public governance;
    uint64 public governanceTimelock;
    bool public deploymentFinished;
    
    bool private initialised;
    bool private executing;
    
    address public proposedGovernance;
    
    address public governanceExecutor;

    mapping(bytes4 => TimelockedCall) private timelockedCalls;
    
    event GovernanceCallTimelocked(bytes4 selector, uint256 allowedAfterTimestamp, bytes encodedCall);
    event TimelockedGovernanceCallExecuted(bytes4 selector, uint256 timestamp);
    
    event GovernanceProposed(address proposedGovernance);
    event GovernanceUpdated(address oldGovernance, address newGovernance);
    
    modifier onlyGovernance {
        if (executing || !deploymentFinished) {
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

    constructor(address _governance, uint256 _timelock) {
        if (_governance != address(0)) {
            initialise(_governance, _timelock);
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
     * @notice First of a two step process for turning over governance to another address.
     * @param _governance The address to propose to receive governance role.
     * @dev Must hold governance to propose another address.
     * @dev Timelocked if not in deployment mode.
     */
    function proposeGovernance(address _governance) external onlyGovernance
    {
        proposedGovernance = _governance;
        emit GovernanceProposed(_governance);
    }
    
    /**
     * @notice Once proposed, claimant can claim the governance role as the second of a two-step process.
     * @dev Always turns the deployment mode off.
     */
    function claimGovernance() external {
        require(msg.sender == proposedGovernance, "not claimaint");
        emit GovernanceUpdated(governance, proposedGovernance);
        governance = proposedGovernance;
        proposedGovernance = address(0);
        // finish deploy on first governance transfer
        deploymentFinished = true;
    }

    /**
     * @notice In a one-step process, turn over governance to another address.
     * @dev Must hold governance to transfer.
     * @dev Timelocked if not in deployment mode. Always turns the deployment mode off.
     */
    function transferGovernance(address _governance) external onlyGovernance {
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
        // finish deploy on first governance transfer
        deploymentFinished = true;
    }

    /**
     * @notice Initialize the governance address if not first initialized.
     */
    function initialise(address _governance, uint256 _timelock) public virtual {
        require(initialised == false, "initialised != false");
        initialised = true;
        
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
        governanceTimelock = SafeCast.toUint64(_timelock);
        proposedGovernance = address(0);
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
        require(msg.sender == governance, "only governance");
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
