// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./IKeptContract.sol";

interface IFTSO {

    /// function finalizePriceReveal
    /// called by Flare Keeper every block
    /// if price reveal period for epoch x ended. finalize.
    /// iterate list of price submissions
    /// find weighted median
    /// find adjucant 50% of price submissions.
    /// Allocate reward for any price submission which is same as a "winning" submission
    function finalizePriceReveal() external;
}