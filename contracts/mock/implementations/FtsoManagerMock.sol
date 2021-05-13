// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0; // note. don't update version.

import "@gnosis.pm/mock-contract/contracts/MockContract.sol";


/**
 * @title Ftso manager mock contract
 * @notice A contract to call the reward manager to distribute rewards for unit testing.
 * @dev TODO: Can we get rid of this by calling web3 api from one contract on behalf of another?
 **/
contract FtsoManagerMock is MockContract {
    address private _rewardManager;

    function setRewardManager(address rewardManager) public {
        _rewardManager = rewardManager;
    }

    function distributeRewardsCall(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochDurationSec,
        uint256 currentRewardEpoch) public {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature(
            "distributeRewards(address[],uint256[],uint256,uint256,address,uint256,uint256)",
            addresses, weights, totalWeight, epochId, ftso, priceEpochDurationSec, currentRewardEpoch);
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = _rewardManager.call(payload);
        require(success);
    }
}
