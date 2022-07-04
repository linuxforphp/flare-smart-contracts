// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/Distribution.sol";


// Distribution with changed setEntitlementStart method
contract DistributionMock is Distribution {

    constructor(
        address _governance,
        address _treasury,
        uint256 _latestEntitlementStartTs
    )
        Distribution(
            _governance,
            _treasury,
            _latestEntitlementStartTs
    ) {

    }

    /** 
     * @notice Start the distribution contract at _entitlementStartTs timestamp
     * @param _entitlementStartTs point in time when we start
     * @dev should be called immediately after all airdrop accounts and balances are set
     */
    function setEntitlementStart(uint256 _entitlementStartTs) external override onlyGovernance {
        require(entitlementStartTs == 0 || entitlementStartTs > block.timestamp, ERR_ALREADY_STARTED);
        // require(_entitlementStartTs >= block.timestamp && _entitlementStartTs <= latestEntitlementStartTs,
        //     ERR_WRONG_START_TIMESTAMP);
        require(treasury.balance >= totalEntitlementWei || address(this).balance >= totalEntitlementWei,
            ERR_OUT_OF_BALANCE);
        entitlementStartTs = _entitlementStartTs;
        emit EntitlementStart(_entitlementStartTs);
    }
}
