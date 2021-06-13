// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IFtsoRewardManager.sol";
import "../interface/IIFtsoManager.sol";
import "../../token/implementation/WFlr.sol";
import "../../utils/implementation/FlareKeeper.sol";

interface IIFtsoRewardManager is IFtsoRewardManager {

    function activate() external;
    function deactivate() external;
    function closeExpiredRewardEpochs() external;

    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochDurationSec,
        uint256 currentRewardEpoch,
        uint256 priceEpochEndTime,
        uint256 votePowerBlock
    ) external;

    function setFTSOManager(IIFtsoManager _ftsoManager) external;
    function setWFLR(WFlr _wFlr) external;
}
