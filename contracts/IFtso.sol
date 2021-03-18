// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


interface IFtso {

    /// function finalizePriceReveal
    /// called by reward manager only on correct timing.
    /// if price reveal period for epoch x ended. finalize.
    /// iterate list of price submissions
    /// find weighted median
    /// find adjucant 50% of price submissions.
    /// Allocate reward for any price submission which is same as a "winning" submission
    function finalizePriceEpoch(uint256 epochId, bool returnRewardData) external returns(
        address[] memory eligibleAddresses,
        uint64[] memory flrWeights,
        uint256 totalFlrWeight
    );

    /// init price epoch data will be called by reward manager once epoch is added 
    /// before this init is done. FTSO can't run.
    function initPriceEpochData(uint256 firstEpochStartTs, uint256 epochPeriod, uint256 revealPeriod) external;

    // current vote power block will update per reward epoch. 
    // the FTSO doesn't have notion of reward epochs.
    // reward manager only can set this data. 
    function setCurrentVotepowerBlock(uint256 blockNumber) external;

    /// function getRandom()
    /// per epoch all submitted random numbers should be accumulated
    /// when epoch finalized, hash this accumulation and save as last random number
    /// this API should return the result
    /// @param random is the random number
    /// TODO: consider returning randomTs = the time stamp this random was created.
    function getFreshRandom() external view returns (uint256 random);

    /// function getPriceRevealEndTimestamp()
    /// should return end timestamp for next price reveal period
    function getEpochData() external view returns (
        uint256 currentEpoch,
        uint256 nextPriceSubmitEndsTs,
        uint256 nextPriceRevealEndTs
    );
}
