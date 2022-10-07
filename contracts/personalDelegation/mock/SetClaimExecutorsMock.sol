// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/DelegationAccountManager.sol";

contract SetClaimExecutorsMock {

    DelegationAccountManager public delegationAccountManager;

    constructor(DelegationAccountManager _delegationAccountManager) {
        delegationAccountManager = _delegationAccountManager;
    }

    function setClaimExecutors(address[] memory _executors) external payable {
        //slither-disable-next-line arbitrary-send-eth
        delegationAccountManager.setClaimExecutors{value: msg.value}(_executors);
    }
}
