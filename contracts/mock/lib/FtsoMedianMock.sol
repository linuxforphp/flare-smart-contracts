// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {FtsoMedian} from "../../lib/FtsoMedian.sol";

/**
 * @title Ftso Vote mock contract
 * @notice A contract to expose the FtsoVote library for unit testing.
 **/
contract FtsoMedianMock {
    using FtsoMedian for FtsoMedian.Data;
    
    function swap(uint256 i, uint256 j, uint256[] memory index) public pure returns (uint256[] memory) {
        FtsoMedian.swap(i, j, index);
        return index;
    }

    function partition(
        uint256 left0,
        uint256 right0,
        uint256 pivotId,
        uint256 leftSum0, 
        uint256 rightSum0,
        uint256[] memory index,
        uint256[] memory price, 
        uint256[] memory weight) public pure returns (
            uint256 pos, 
            uint256 leftSum, 
            uint256 rightSum, 
            uint256[] memory,
            uint256[] memory, 
            uint256[] memory) {
        (pos, leftSum, rightSum) = 
            FtsoMedian.partition(left0, right0, pivotId, leftSum0, rightSum0, index, price, weight);
        return (pos, leftSum, rightSum, index, price, weight);
    }

    function samePriceFix(
        uint256 start,
        uint256 end,
        int8 direction,
        uint256 sumInit,
        uint256[] memory index,
        uint256[] memory price,
        uint256[] memory weight) public pure returns (
            uint256 pos, 
            uint256 sum,
            uint256[] memory,
            uint256[] memory, 
            uint256[] memory) {
        (pos, sum) = FtsoMedian.samePriceFix(start, end, direction, sumInit, index, price, weight);
        return (pos, sum, index, price, weight);
    }

    function closestPriceFix(
        uint256 start,
        uint256 end,
        uint256[] memory index,
        uint256[] memory price) public pure returns (uint256) {
        return FtsoMedian.closestPriceFix(start, end, index, price);
    }

    function compute(
        uint256[] memory price,
        uint256[] memory weight) public view returns (
            uint256[] memory index, 
            FtsoMedian.Data memory d,
            uint256[] memory,
            uint256[] memory) {
        (index, d) = FtsoMedian.compute(price, weight);
        return (index, d, price, weight);
    }
}