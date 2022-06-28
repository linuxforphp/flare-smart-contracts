// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";


contract GovernedWithTimelock {
    struct TimelockedCall {
        uint256 allowedAfterTimestamp;
        bytes encodedCall;
    }
    
    address public governance;
    uint64 public timelock;
    bool public deploymentFinished;
    
    bool private initialised;
    bool private executing;
    
    address public proposedGovernance;
    
    mapping(bytes4 => TimelockedCall) private timelockedCalls;
    
    address[] private executors;
    mapping(address => bool) private isExecutor;

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
        governance = _governance;
        timelock = SafeCast.toUint64(_timelock);
    }

    function setGovernanceExecutors(address[] memory _executors)
        external 
        onlyImmediateGovernance
    {
        require(_executors.length >= 1, "empty executors list");
        // clear old
        for (uint256 i = 0; i < executors.length; i++) {
            isExecutor[executors[i]] = false;
        }
        delete executors;
        // set new
        for (uint256 i = 0; i < _executors.length; i++) {
            executors.push(_executors[i]);
            isExecutor[_executors[i]] = true;
        }
    }

    function executeGovernanceCall(bytes4 _selector) external {
        require(isExecutor[msg.sender], "only executor");
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
    
    function proposeGovernance(address _governance)
        external
        onlyGovernance
    {
        proposedGovernance = _governance;
        emit GovernanceProposed(_governance);
    }
    
    function claimGovernance() external {
        require(msg.sender == proposedGovernance, "not claimaint");
        emit GovernanceUpdated(governance, proposedGovernance);
        governance = proposedGovernance;
        proposedGovernance = address(0);
        // finish deploy on first governance transfer
        deploymentFinished = true;
    }

    // Allows one step propose-execute-claim governance change (still timelocked if not in deployment mode).
    // Also ends the deployment mode.
    function transferGovernance(address _governance)
        external
        onlyGovernance
    {
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
        // finish deploy on first governance transfer
        deploymentFinished = true;
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
        uint256 allowedAt = block.timestamp + timelock;
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
