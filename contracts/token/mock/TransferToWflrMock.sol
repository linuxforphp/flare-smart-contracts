// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IWFlr} from "../../userInterfaces/IWFlr.sol";

/**
 * @notice Provide a means to test behavior of WFLR when flares are transfered to it.
 **/
contract TransferToWflrMock {
    receive() external payable {
    }

    function transferToWflr(address payable wflr, uint256 amount) public {
        wflr.transfer(amount);
    }

    function depositToWflr(address payable wflr, uint256 amount) public {
        IWFlr(wflr).deposit{ value: amount }();
    }
}
