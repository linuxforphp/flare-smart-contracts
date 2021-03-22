// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../IFtso.sol";


contract FtsoMock is IFtso {
    // Put good stuff here to make this a flexible mock
    constructor() {}

    function finalizePriceEpoch(uint256 epochId, bool returnRewardData) external override returns(
        address[] memory eligibleAddresses,
        uint64[] memory flrWeights,
        uint256 totalFlrWeight
    ) {}

    function initPriceEpochData(
        uint256 firstEpochStartTs, 
        uint256 epochPeriod, 
        uint256 revealPeriod) external override {}

    function setCurrentVotepowerBlock(uint256 blockNumber) external override {}

    function getFreshRandom() external view override returns (uint256 random) {}

    function getEpochData() external view override returns (
        uint256 currentEpoch,
        uint256 nextPriceSubmitEndsTs,
        uint256 nextPriceRevealEndTs
    ) {}
}