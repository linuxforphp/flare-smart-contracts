// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library FtsoMedian {

    struct Data {
        uint256 medianIndex;
        uint256 quartile1Index;
        uint256 quartile3Index;
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
        uint256 totalSum;
        uint256 finalMedianPrice;
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
        uint256 pos;
        uint256 left;
        uint256 right;
        uint256 pivotId;
    }

    function compute(
        uint256[] memory price,
        uint256[] memory weight
    ) internal view returns (
        uint256[] memory index,
        Data memory d)
    {
        uint256 count = price.length;

        index = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            index[i] = i;
        }

        (d.medianIndex, d.leftSum2, d.rightSum2) = quickSelect(
            2,
            0,
            count - 1,
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

        if (d.medianIndex == count - 1) {
            (d.quartile3Index, d.leftSum3, d.rightSum3) = (d.medianIndex, d.leftSum2, 0);
        } else if (d.rightSum2 <= d.totalSum / 4) { 
            (d.quartile3Index, d.leftSum3, d.rightSum3) = (d.medianIndex, d.leftSum2, d.rightSum2);
        } else {
            (d.quartile3Index, d.leftSum3, d.rightSum3) = quickSelect(
                3,
                d.medianIndex + 1,
                count - 1,
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
                (d.finalMedianPrice + closestPriceFix(d.medianIndex, count - 1, index, price)) / 2;
        }

        (d.quartile1Index, d.lowWeightSum) = samePriceFix(
            d.quartile1Index, 0, -1, d.leftSum1, index, price, weight);
        (d.quartile3Index, d.highWeightSum) = samePriceFix(
            d.quartile3Index, count - 1, 1, d.rightSum3, index, price, weight);
        d.rewardedWeightSum = d.leftSum2 + d.rightSum2 + d.medianWeight - d.lowWeightSum - d.highWeightSum;
    }

    function swap(uint256 i, uint256 j, uint256[] memory index) internal pure {
        if (i == j) return;
        uint256 tmp = index[i];
        index[i] = index[j];
        index[j] = tmp;
    }

    function partition(
        uint256 left0,
        uint256 right0,
        uint256 pivotId,
        uint256 leftSum0, 
        uint256 rightSum0,
        uint256[] memory index,
        uint256[] memory price, 
        uint256[] memory weight
    )
        internal pure
        returns (uint256, uint256, uint256)
    {
        uint256 pivotValue = price[index[pivotId]];
        uint256[] memory sums = new uint256[](2);
        sums[0] = leftSum0;
        sums[1] = rightSum0;
        uint256 left = left0;
        uint256 right = right0;
        swap(pivotId, right, index);
        uint256 storeIndex = left;
        for (uint256 i = left; i < right; i++) {
            uint256 eltId = index[i];
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
        uint256 k,
        uint256 start,
        uint256 end,
        uint256 leftSumInit,
        uint256 rightSumInit,
        uint256[] memory index,
        uint256[] memory price, 
        uint256[] memory weight
     )
        internal view
        returns (uint256, uint256, uint256)
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
        uint256 random = uint256(keccak256(abi.encode(block.difficulty, block.timestamp)));
        uint256 totalSum; 
        while (true) {
            // guarantee: pos is in [left,right] and newLeftSum >= leftSum, newRightSum >= rightSum !!!
            (p.pos, s.newLeftSum, s.newRightSum) = partition(
                p.left,
                p.right,
                (random % (p.right - p.left + 1)) + p.left, // pivot randomization
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
        uint256 start,
        uint256 end,
        int256 direction,
        uint256 sumInit,
        uint256[] memory index,
        uint256[] memory price,
        uint256[] memory weight
    )
        internal pure
        returns (uint256, uint256)
    {
        uint256 weightSum = sumInit;
        if ((int256(start) - int256(end)) * direction >= 0) return (start, sumInit);
        uint256 thePrice = price[index[start]];
        int256 storeIndex = int256(start) + direction;
        uint256 eltId;
        for (int256 i = int256(start) + direction; (i - int256(end)) * direction <= 0; i += direction) {
            eltId = index[uint256(i)];
            if (price[eltId] == thePrice) {
                weightSum -= weight[eltId];
                swap(uint256(storeIndex), uint256(i), index);
                storeIndex += direction;
            }
        }
        return (uint256(storeIndex - direction), weightSum);
    }

    function closestPriceFix(
        uint256 start,
        uint256 end,
        uint256[] memory index,
        uint256[] memory price
    )
        internal pure returns (uint256)
    {
        if (start == end) {
            return price[index[start]];
        }

        uint closestPrice = price[index[start + 1]];
        uint newPrice;
        for (uint256 i = start + 2; i <= end; i++) {
            newPrice = price[index[i]];
            // assumes all the elements to the right of start are greater or equal 
            if (newPrice < closestPrice) {
                closestPrice = newPrice;
            }
        }
        return closestPrice;
    }

}
