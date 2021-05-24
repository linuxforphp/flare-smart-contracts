// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IFtsoRewardManager.sol";
import "../interface/IIFtsoManager.sol";
import "../../token/implementation/WFlr.sol";
import "../../accounting/implementation/BalanceSynchronizer.sol";


interface IIFtsoRewardManager is IFtsoRewardManager {

    function closeExpiredRewardEpochs() external;

    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochsRemaining,
        uint256 currentRewardEpoch
    ) external returns (bool);

    function setFTSOManager(IIFtsoManager _ftsoManager) external;
    function setBalanceSynchronizer(BalanceSynchronizer _balanceSynchronizer) external;
    function getUnreportedClaimsAndFlush() external returns (uint256);
    function setWFLR(WFlr _wFlr) external;
}
