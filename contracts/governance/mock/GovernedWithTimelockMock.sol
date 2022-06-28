// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/GovernedWithTimelock.sol";


contract GovernedWithTimelockMock is GovernedWithTimelock {
    uint256 public a;
    uint256 public b;
    
    constructor(address _governance, uint256 _timelock)
        GovernedWithTimelock(_governance, _timelock)
    {
    }

    function changeA(uint256 _value)
        external
        onlyGovernance
    {
        a = _value;
    }


    function changeWithRevert(uint256 _value)
        external
        onlyGovernance
    {
        a = _value;
        revert("this is revert");
    }

    function changeB(uint256 _value)
        external
        onlyImmediateGovernance
    {
        b = _value;
    }
}
