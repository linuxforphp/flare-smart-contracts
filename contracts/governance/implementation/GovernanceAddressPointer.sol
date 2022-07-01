// (c) 2021, Flare Networks Limited. All rights reserved.
// Please see the file LICENSE for licensing terms.

// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

///////////////////
// A special contract that will hold Flare governance address 
//      this contract enables updating governance address only by hard forking the network
//      meaning only by updating validator code.
//////////////////
contract GovernanceAddressPointer {

    address public constant SIGNAL_COINBASE = address(0x00000000000000000000000000000000000dEAD0);

    uint256 internal constant MAX_TIMELOCK = 365 days;
    
    // governance address set by the validator (initialy set in cTor)
    address private governanceAddress;
    
    // global timelock setting, also set by validator (initialy set in cTor)
    uint64 private timelock;
    
    // executor addresses, changeable anytime by the governance
    address[] private executors;
    mapping (address => bool) private executorMap;

    event GovernanceAddressUpdated(
        uint256 timestamp,
        address oldGovernanceAddress,
        address newGovernanceAddress
    );

    event GovernanceTimelockUpdated(
        uint256 timestamp,
        uint256 oldTimelock,
        uint256 newTimelock
    );

    event GovernanceExecutorsUpdated(
        uint256 timestamp,
        address[] oldExecutors,
        address[] newExecutors
    );

    constructor(address _governanceAddress, uint256 _timelock, address[] memory _executors) {
        require(_timelock < MAX_TIMELOCK, "timelock too large");
        governanceAddress = _governanceAddress;
        timelock = uint64(_timelock);
        _setExecutors(_executors);
    }

    /**
     * Change the governance address.
     * Can only be called by validators via fork.
     */
    function setGovernanceAddress(address _newGovernance) external {
        require(governanceAddress != _newGovernance, "governanceAddress == _newGovernance");
        if (msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE) {
            emit GovernanceAddressUpdated(block.timestamp, governanceAddress, _newGovernance);
            governanceAddress = _newGovernance;
        }
    }

    /**
     * Change the timelock.
     * Can only be called by validators via fork.
     */
    function setTimelock(uint256 _newTimelock) external {
        require(timelock != _newTimelock, "timelock == _newTimelock");
        require(_newTimelock < MAX_TIMELOCK, "timelock too large");
        if (msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE) {
            emit GovernanceTimelockUpdated(block.timestamp, timelock, _newTimelock);
            timelock = uint64(_newTimelock);
        }
    }
    
    /**
     * Set the addresses of the accounts that are allowed to execute the timelocked governance calls
     * once the timelock period expires.
     * It isn't very dangerous to allow for anyone to execute timelocked calls, but we reserve the right to
     * make sure the timing of the execution is under control.
     */
    function setExecutors(address[] memory _newExecutors) external {
        require(msg.sender == governanceAddress, "only governance");
        _setExecutors(_newExecutors);
    }
    
    /**
     * Get the governance account address.
     */
    function getGovernanceAddress() external view returns (address) {
        return governanceAddress;
    }
    
    /**
     * Get the time that must pass between a governance call and execution.
     */
    function getTimelock() external view returns (uint256) {
        return timelock;
    }
    
    /**
     * Get the addresses of the accounts that are allowed to execute the timelocked governance calls
     * once the timelock period expires.
     */
    function getExecutors() external view returns (address[] memory) {
        return executors;
    }
    
    /**
     * Check whether an address is allowed to execute an governance call after timelock expires.
     */
    function isExecutor(address _address) external view returns (bool) {
        return executorMap[_address];
    }

    function _setExecutors(address[] memory _newExecutors) private {
        emit GovernanceExecutorsUpdated(block.timestamp, executors, _newExecutors);
        // clear old
        while (executors.length > 0) {
            executorMap[executors[executors.length - 1]] = false;
            executors.pop();
        }
        // set new
        for (uint256 i = 0; i < _newExecutors.length; i++) {
            executors.push(_newExecutors[i]);
            executorMap[_newExecutors[i]] = true;
        }
    }
}
