// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @title Supply contract
 * @notice This contract maintains and computes various FLR supply totals.
 **/

contract Supply {
    //solhint-disable no-unused-vars
    function addAuthorizedInflation(uint256 amountWei) external {}
    function getCirculatingBalanceAt(uint256 blockNumber) external pure returns(uint256 _circulatingBalanceWei) {
        return 0;
    }
    function getInflatableBalance() external pure returns(uint256 _inflatableBalanceWei) {
        return 100000000000 ether;
    }
}