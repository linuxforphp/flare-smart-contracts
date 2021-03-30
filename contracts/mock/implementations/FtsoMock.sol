// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../IFtso.sol";


contract FtsoMock is IFtso {
    // Put good stuff here to make this a flexible mock
    constructor() {}

    function finalizePriceEpoch(uint256 epochId, bool returnRewardData) external override returns(
        address[] memory eligibleAddresses,
        uint256[] memory flrWeights,
        uint256 totalFlrWeight
    ) {}

    function initializeEpochs(
        uint256 firstEpochStartTs, 
        uint256 epochPeriod, 
        uint256 revealPeriod) external override {}

    function configureEpochs(
        uint256 minVoteCount,
        uint256 maxVoteCount,
        uint256 minVotePowerFlrDenomination,
        uint256 minVotePowerAssetDenomination,
        uint256 maxVotePowerFlrDenomination,
        uint256 maxVotePowerAssetDenomination,
        uint256 lowAssetUSDThreshold,
        uint256 highAssetUSDThreshold,
        uint256 highAssetTurnoutThreshold
    ) external override {}

    function setVotePowerBlock(uint256 blockNumber) external override {}

    function getCurrentRandom() external view override returns (uint256 random) {}

    function getEpochData() external view override returns (
        uint256 currentEpoch,
        uint256 nextPriceSubmitEndsTs,
        uint256 nextPriceRevealEndTs
    ) {}

    function getCurrentPrice() external view override returns (uint256) {}

    function getEpochPrice(uint256 epochId) external view override returns (uint256) {}
    
    function getEpochPriceForVoter(uint256 epochId, address voter) external view override returns (uint256) {}
}