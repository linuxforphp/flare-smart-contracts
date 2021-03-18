// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library WeightedMedian {

    struct Data {
        uint32 medianIndex;
        uint32 quartile1Index;
        uint32 quartile3Index;
        uint32 quartile1IndexOriginal;
        uint32 quartile3IndexOriginal;
        uint32 length;
        uint256 leftSum1;
        uint256 rightSum1;
        uint256 leftSum2;
        uint256 rightSum2; 
        uint256 leftSum3;
        uint256 rightSum3;
        uint256 leftMedianWeight;
        uint256 rightMedianWeight;
        uint256 medianWeight;
        uint256 lowWeightSum;
        uint256 rewardedWeightSum;
        uint256 highWeightSum;
        uint256 finalMedianPrice;
        uint256 totalSum;
    }

    struct QSVariables {
        uint256 leftSum;
        uint256 rightSum;
        uint256 newLeftSum;
        uint256 newRightSum;
        uint256 pivotWeight;
        uint256 leftMedianWeight;
        uint256 rightMedianWeight;
    }

    struct QSPositions {
        uint32 pos;
        uint32 left;
        uint32 right;
        uint32 pivotId;
    }

    function compute(
        uint128[] memory price,
        uint256[] memory weight
    ) internal view returns (
        uint32[] memory index,
        Data memory d)
    {
        d.length = uint32(price.length);

        index = new uint32[](d.length);
        for (uint32 i = 0; i < d.length; i++) {
            index[i] = i;
        }

        (d.medianIndex, d.leftSum2, d.rightSum2) = quickSelect(
            2,
            0,
            d.length - 1,
            0,
            0,
            index,
            price,
            weight
        );

        d.medianWeight = weight[index[d.medianIndex]];

        d.totalSum = d.medianWeight + d.leftSum2 + d.rightSum2;

        // calculate quartile bounds without moving the median element
        if (d.medianIndex == 0) {
            (d.quartile1Index, d.leftSum1, d.rightSum1) = (d.medianIndex, 0, d.rightSum2);
        } else if (d.leftSum2 <= d.totalSum / 4) { 
            (d.quartile1Index, d.leftSum1, d.rightSum1) = (d.medianIndex, d.leftSum2, d.rightSum2);
        } else {
            (d.quartile1Index, d.leftSum1, d.rightSum1) = quickSelect(
                1,
                0,
                d.medianIndex - 1,
                0,
                d.rightSum2 + d.medianWeight,
                index,
                price,
                weight
            );
        }

        if (d.medianIndex == d.length - 1) {
            (d.quartile3Index, d.leftSum3, d.rightSum3) = (d.medianIndex, d.leftSum2, 0);
        } else if (d.rightSum2 <= d.totalSum / 4) { 
            (d.quartile3Index, d.leftSum3, d.rightSum3) = (d.medianIndex, d.leftSum2, d.rightSum2);
        } else {
            (d.quartile3Index, d.leftSum3, d.rightSum3) = quickSelect(
                3,
                d.medianIndex + 1,
                d.length - 1,
                d.leftSum2 + d.medianWeight,
                0,
                index,
                price,
                weight
            );
        }

        d.finalMedianPrice = price[index[d.medianIndex]];
        if (d.leftSum2 + d.medianWeight == d.totalSum / 2 && d.totalSum % 2 == 0) {
            d.finalMedianPrice =
                (d.finalMedianPrice + closestPriceFix(d.medianIndex, d.length - 1, index, price)) / 2;
        }

        d.quartile1IndexOriginal = d.quartile1Index;
        d.quartile3IndexOriginal = d.quartile3Index;

        (d.quartile1Index, d.lowWeightSum) = samePriceFix(
            d.quartile1Index, 0, -1, d.leftSum1, index, price, weight);
        (d.quartile3Index, d.highWeightSum) = samePriceFix(
            d.quartile3Index, d.length - 1, 1, d.rightSum3, index, price, weight);
        d.rewardedWeightSum = d.leftSum2 + d.rightSum2 + d.medianWeight - d.lowWeightSum - d.highWeightSum;
    }

    function swap(uint32 i, uint32 j, uint32[] memory index) internal pure {
        if (i == j) return;
        uint32 tmp = index[i];
        index[i] = index[j];
        index[j] = tmp;
    }

    function partition(
        uint32 left0,
        uint32 right0,
        uint32 pivotId,
        uint256 leftSum0, 
        uint256 rightSum0,
        uint32[] memory index,
        uint128[] memory price, 
        uint256[] memory weight
    )
        internal pure
        returns (uint32, uint256, uint256)
    {
        uint256 pivotValue = price[index[pivotId]];
        uint256[] memory sums = new uint256[](2);
        sums[0] = leftSum0;
        sums[1] = rightSum0;
        uint32 left = left0;
        uint32 right = right0;
        swap(pivotId, right, index);
        uint32 storeIndex = left;
        for (uint32 i = left; i < right; i++) {
            uint32 eltId = index[i];
            if (price[eltId] < pivotValue) {
                sums[0] += weight[eltId];
                swap(storeIndex, i, index);
                storeIndex++;
            } else {
                sums[1] += weight[eltId];
            }
        }
        swap(right, storeIndex, index);
        return (storeIndex, sums[0], sums[1]);
    }

    function quickSelect(
        uint8 k,
        uint32 start,
        uint32 end,
        uint256 leftSumInit,
        uint256 rightSumInit,
        uint32[] memory index,
        uint128[] memory price, 
        uint256[] memory weight
     )
        internal view
        returns (uint32, uint256, uint256)
     {
        if (start == end) {
            return (start, leftSumInit, rightSumInit);
        }
        QSVariables memory s;
        s.leftSum = leftSumInit;
        s.rightSum = rightSumInit;
        QSPositions memory p;
        p.left = start;
        p.right = end;
        uint32 random = uint32(uint256(keccak256(abi.encodePacked(block.difficulty, block.timestamp))));
        uint256 totalSum; 
        while (true) {
            // guarantee: pos is in [left,right] and newLeftSum >= leftSum, newRightSum >= rightSum !!!
            (p.pos, s.newLeftSum, s.newRightSum) = partition(
                p.left,
                p.right,
                true ? (random)%(p.right - p.left + 1) + p.left : p.right, // pivot randomization
                s.leftSum,
                s.rightSum,
                index,
                price,
                weight
            );
            
            p.pivotId = index[p.pos];
            s.pivotWeight = weight[p.pivotId];
            totalSum = s.pivotWeight + s.newLeftSum + s.newRightSum;
            if (k == 2) {
                // last element of s.leftMedianWeight is the real median
                s.leftMedianWeight = totalSum / 2 + (totalSum % 2);  
                s.rightMedianWeight = totalSum - s.leftMedianWeight; 
                // if newSumLeft is contains the median weight!
                if (s.newLeftSum >= s.leftMedianWeight && s.leftMedianWeight > leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum > s.rightMedianWeight && s.rightMedianWeight > rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            } else if (k == 1) {
                s.leftMedianWeight = totalSum / 4;
                // rightMedianWeight contains the correct first weight
                s.rightMedianWeight = totalSum - s.leftMedianWeight;
                if (s.newLeftSum > s.leftMedianWeight && s.leftMedianWeight > leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum >= s.rightMedianWeight && s.rightMedianWeight > rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            } else { // k = 3 - outward bias due to division
                s.rightMedianWeight = totalSum / 4;
                // leftMedianWeight contains the correct last weight
                s.leftMedianWeight = totalSum - s.rightMedianWeight;
                if (s.newLeftSum >= s.leftMedianWeight && s.leftMedianWeight > leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum > s.rightMedianWeight && s.rightMedianWeight > rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            }
        }
        return (0, 0, 0); // never happens
    }

    function samePriceFix(
        uint32 start,
        uint32 end,
        int8 direction,
        uint256 sumInit,
        uint32[] memory index,
        uint128[] memory price,
        uint256[] memory weight
    )
        internal pure
        returns (uint32, uint256)
    {
        uint weightSum = sumInit;
        if ((int32(start) - int32(end)) * direction >= 0) return (start, sumInit);
        uint thePrice = price[index[start]];
        int32 storeIndex = int32(start) + direction;
        uint32 eltId;
        for (int32 i = int32(start) + direction; (i - int32(end)) * direction <= 0; i += direction) {
            eltId = index[uint32(i)];
            if (price[eltId] == thePrice) {
                weightSum -= weight[eltId];
                swap(uint32(storeIndex), uint32(i), index);
                storeIndex += direction;
            }
        }
        return (uint32(storeIndex - direction), weightSum);
    }

    function closestPriceFix(
        uint32 start,
        uint32 end,
        uint32[] memory index,
        uint128[] memory price
    )
        internal pure returns (uint32)
    {
        if (start == end) return start;
        uint closestPrice = price[index[start + 1]];
        uint newPrice;
        for (uint32 i = start + 2; i <= end; i++) {
            newPrice = price[index[i]];
            // assumes all the elements to the right of start are greater or equal 
            if (newPrice < closestPrice) {
                swap(start + 1, i, index);
                closestPrice = newPrice;
            }
        }
        return start + 1;
    }

}
