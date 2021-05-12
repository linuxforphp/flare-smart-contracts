// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/internal/IIFtso.sol";

interface IFtsoManager {

    event FtsoAdded(IIFtso ftso, bool add);
    event RewardEpochFinalized(uint256 votepowerBlock, uint256 startBlock);
    event PriceEpochFinalized(address chosenFtso, uint256 rewardEpochId);
    // TODO: Remove these two events for production
    event KeepTrigger(uint256 blockNumber, uint256 timestamp);  // for monitoring keep() calls

    function setGovernanceParameters(
        uint256 _minVotePowerFlrThreshold,
        uint256 _minVotePowerAssetThreshold,
        uint256 _maxVotePowerFlrThreshold,
        uint256 _maxVotePowerAssetThreshold,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutBIPSThreshold,
        uint256 _lowFlrTurnoutBIPSThreshold,
        address[] memory _trustedAddresses
    ) external;

    function getCurrentRewardEpoch() external view returns (uint256);
    function getCurrentPriceEpochData() external view returns 
        (
            uint256 priceEpochId, 
            uint256 priceEpochStartTimestamp, 
            uint256 priceEpochEndTimestamp, 
            uint256 priceEpochRevealEndTimestamp, 
            uint256 currentTimestamp
        );        
    function getFtsos() external view returns (IIFtso[] memory ftsos);
    function getPriceEpochConfiguration() external view returns 
        (uint256 firstPriceEpochStartTs, uint256 priceEpochDurationSec, uint256 revealEpochDurationSec);
}
