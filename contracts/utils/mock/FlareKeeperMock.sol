// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0; // note. don't update version.

import "@gnosis.pm/mock-contract/contracts/MockContract.sol";

/**
 * @title FlareKeeper mock contract
 * @notice A contract to simulate flare keeper keeping and to request minting.
 **/
contract FlareKeeperMock is MockContract {
    address[] public keepContracts;

    function registerToKeep(address _keep) public {
        uint256 len = keepContracts.length;
        for (uint256 i = 0; i < len; i++) {
            if (_keep == keepContracts[i]) {
                return; // already registered
            }
        }

        keepContracts.push(_keep);
    }

    function trigger() public {
        uint256 len = keepContracts.length;
        for (uint256 i = 0; i < len; i++) {
            // This low level call is being done because of mixed Solidity version requirements between
            // this project and the MockContract component.
            bytes memory payload = abi.encodeWithSignature("keep()");
            //solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = keepContracts[i].call(payload);
            require(success);
        }
    }

    function callReceiveMinting(address _inflation) public payable {
        // This low level call is being done because of mixed Solidity version requirements between
        // this project and the MockContract component.
        bytes memory payload = abi.encodeWithSignature("receiveMinting()");
        //solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = _inflation.call{ value: msg.value }(payload);
        require(success);
    }
}
