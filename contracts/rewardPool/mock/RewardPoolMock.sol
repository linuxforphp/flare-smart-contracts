// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0; // note. don't update version.

import "@gnosis.pm/mock-contract/contracts/MockContract.sol";


/**
 * @title Reward pool mock contract
 * @notice A contract to call the supply contract to update distributed amount (updateRewardPoolDistributedAmount)
 * @dev TODO: Can we get rid of this by calling web3 api from one contract on behalf of another?
 **/
contract RewardPoolMock is MockContract {
    address private supply;

    function setSupply(address _supply) public {
        supply = _supply;
    }

    function updateRewardPoolDistributedAmountCall(
        uint256 _distributedAmountWei) public {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature(
            "updateRewardPoolDistributedAmount(uint256)", _distributedAmountWei);
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = supply.call(payload);
        require(success);
    }
}
