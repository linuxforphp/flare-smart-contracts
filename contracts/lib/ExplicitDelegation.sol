// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {CheckPointsByAddress} from "./CheckPointsByAddress.sol";
import {CheckPointHistory} from "./CheckPointHistory.sol";
import {EnumerableAddressToUintMap} from "./EnumerableAddressToUintMap.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafePct} from "./SafePct.sol";


// TODO: move functionality from VotePower here

/**
 * @title Delegation library
 * @notice A library to manage a group of delegates for allocating voting power by a delegator.
 **/
library ExplicitDelegation {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of delegates (a Delegation) for a delegator.
     */
    struct DelegationState {
        CheckPointHistory.CheckPointHistoryState delegatedTotal;
        
        // // `delegatedVotePower` is a map of delegators pointing to a map of delegates
        // // containing a checkpoint history of delegated vote power balances.
        // CheckPointsByAddress.CheckPointsByAddressState delegatedVotePower;
    }

    function getDelegateTotalAt(DelegationState storage self, uint256 blockNumber) internal view returns (uint256) {
        return self.delegatedTotal.valueAt(blockNumber);
    }
    
    function getDelegateTotal(DelegationState storage self) internal view returns (uint256) {
        return self.delegatedTotal.valueAtNow();
    }
    
    function delegateAt(DelegationState storage self, uint256 amount, uint256 blockNumber) internal {
        uint256 value = self.delegatedTotal.valueAt(blockNumber).add(amount);
        self.delegatedTotal.writeValueAt(value, blockNumber);
    }

    function delegate(DelegationState storage self, uint256 amount) internal {
        uint256 value = self.delegatedTotal.valueAtNow().add(amount);
        self.delegatedTotal.writeValueAtNow(value);
    }

    function undelegateAt(DelegationState storage self, uint256 amount, uint256 blockNumber) internal {
        uint256 value = self.delegatedTotal.valueAt(blockNumber).sub(amount, "Total < 0");
        self.delegatedTotal.writeValueAt(value, blockNumber);
    }
    
    function undelegate(DelegationState storage self, uint256 amount) internal {
        uint256 value = self.delegatedTotal.valueAtNow().sub(amount, "Total < 0");
        self.delegatedTotal.writeValueAtNow(value);
    }
}