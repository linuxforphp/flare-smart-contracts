// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IKeptContract.sol";

interface IFTSO is IKeptContract {
    struct PriceSubmissionData {
        address dataProvider;
        bytes32 hash;
        address[] delegations; //big array!!
        uint256[] votePower;
    }

    // last submission per data provider, odd and even
    mapping (bool => mapping (address => PriceSubmissionData)) lastPriceSubmission;
    function submitPrice() external returns (bool success);

    function priceReveal() external reutnrs
    priceSubmission
    /// function finalizePriceReveal
    /// called by Flare Keeper every block
    /// if price reveal period for epoch x ended. finalize.
    /// iterate list of price submissions
    /// find weighted median
    /// find adjucant 50% of price submissions.
    /// Allocate reward for any price submission which is same as a "winning" submission
    function finalizePriceReveal() external;
}