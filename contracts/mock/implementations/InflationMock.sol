// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@gnosis.pm/mock-contract/contracts/MockContract.sol";
/**
 * @title Inflation mock contract
 * @notice A contract to call the reward manager for setting daily reward amounts for unit testing.
 * @dev TODO: Can we get rid of this by calling web3 api from one contract on behalf of another?
 **/
contract InflationMock is MockContract {
    address private _rewardManager;

    function setRewardManager(address rewardManager) public {
        _rewardManager = rewardManager;
    }

    function setRewardManagerDailyRewardAmount(uint256 amount) public {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature("setDailyRewardAmount(uint256)", amount);
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = _rewardManager.call(payload);
        require(success);
    }
}
