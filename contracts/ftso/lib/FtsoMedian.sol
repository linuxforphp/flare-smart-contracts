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

    function _compute(
        uint256[] memory _price,
        uint256[] memory _weight
    ) internal view returns (
        uint256[] memory _index,
        Data memory _d)
    {
        uint256 count = _price.length;

        _index = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            _index[i] = i;
        }

        (_d.medianIndex, _d.leftSum2, _d.rightSum2) = _quickSelect(
            2,
            0,
            count - 1,
            0,
            0,
            _index,
            _price,
            _weight
        );

        _d.medianWeight = _weight[_index[_d.medianIndex]];

        _d.totalSum = _d.medianWeight + _d.leftSum2 + _d.rightSum2;

        // calculate quartile bounds without moving the median element
        if (_d.medianIndex == 0) {
            (_d.quartile1Index, _d.leftSum1, _d.rightSum1) = (_d.medianIndex, 0, _d.rightSum2);
        } else if (_d.leftSum2 <= _d.totalSum / 4) { 
            (_d.quartile1Index, _d.leftSum1, _d.rightSum1) = (_d.medianIndex, _d.leftSum2, _d.rightSum2);
        } else {
            (_d.quartile1Index, _d.leftSum1, _d.rightSum1) = _quickSelect(
                1,
                0,
                _d.medianIndex - 1,
                0,
                _d.rightSum2 + _d.medianWeight,
                _index,
                _price,
                _weight
            );
        }

        if (_d.medianIndex == count - 1) {
            (_d.quartile3Index, _d.leftSum3, _d.rightSum3) = (_d.medianIndex, _d.leftSum2, 0);
        } else if (_d.rightSum2 <= _d.totalSum / 4) { 
            (_d.quartile3Index, _d.leftSum3, _d.rightSum3) = (_d.medianIndex, _d.leftSum2, _d.rightSum2);
        } else {
            (_d.quartile3Index, _d.leftSum3, _d.rightSum3) = _quickSelect(
                3,
                _d.medianIndex + 1,
                count - 1,
                _d.leftSum2 + _d.medianWeight,
                0,
                _index,
                _price,
                _weight
            );
        }

        _d.finalMedianPrice = _price[_index[_d.medianIndex]];
        if (_d.leftSum2 + _d.medianWeight == _d.totalSum / 2 && _d.totalSum % 2 == 0) {
            _d.finalMedianPrice =
                (_d.finalMedianPrice + _closestPriceFix(_d.medianIndex, count - 1, _index, _price)) / 2;
        }

        (_d.quartile1Index, _d.lowWeightSum) = _samePriceFix(
            _d.quartile1Index, 0, -1, _d.leftSum1, _index, _price, _weight);
        (_d.quartile3Index, _d.highWeightSum) = _samePriceFix(
            _d.quartile3Index, count - 1, 1, _d.rightSum3, _index, _price, _weight);
        _d.rewardedWeightSum = _d.leftSum2 + _d.rightSum2 + _d.medianWeight - _d.lowWeightSum - _d.highWeightSum;
    }

    function _swap(uint256 _i, uint256 _j, uint256[] memory _index) internal pure {
        if (_i == _j) return;
        uint256 tmp = _index[_i];
        _index[_i] = _index[_j];
        _index[_j] = tmp;
    }

    function _partition(
        uint256 left0,
        uint256 right0,
        uint256 pivotId,
        uint256 leftSum0, 
        uint256 rightSum0,
        uint256[] memory index,
        uint256[] memory price, 
        uint256[] memory weight
    )
        internal pure returns (uint256, uint256, uint256)
    {
        uint256 pivotValue = price[index[pivotId]];
        uint256[] memory sums = new uint256[](2);
        sums[0] = leftSum0;
        sums[1] = rightSum0;
        uint256 left = left0;
        uint256 right = right0;
        _swap(pivotId, right, index);
        uint256 storeIndex = left;
        for (uint256 i = left; i < right; i++) {
            uint256 eltId = index[i];
            if (price[eltId] < pivotValue) {
                sums[0] += weight[eltId];
                _swap(storeIndex, i, index);
                storeIndex++;
            } else {
                sums[1] += weight[eltId];
            }
        }
        _swap(right, storeIndex, index);
        return (storeIndex, sums[0], sums[1]);
    }

    function _quickSelect(
        uint256 _k,
        uint256 _start,
        uint256 _end,
        uint256 _leftSumInit,
        uint256 _rightSumInit,
        uint256[] memory _index,
        uint256[] memory _price, 
        uint256[] memory _weight
     )
        internal view returns (uint256, uint256, uint256)
     {
        if (_start == _end) {
            return (_start, _leftSumInit, _rightSumInit);
        }
        QSVariables memory s;
        s.leftSum = _leftSumInit;
        s.rightSum = _rightSumInit;
        QSPositions memory p;
        p.left = _start;
        p.right = _end;
        uint256 random = uint256(keccak256(abi.encode(block.difficulty, block.timestamp)));
        uint256 totalSum; 
        while (true) {
            // guarantee: pos is in [left,right] and newLeftSum >= leftSum, newRightSum >= rightSum !!!
            (p.pos, s.newLeftSum, s.newRightSum) = _partition(
                p.left,
                p.right,
                (random % (p.right - p.left + 1)) + p.left, // pivot randomization
                s.leftSum,
                s.rightSum,
                _index,
                _price,
                _weight
            );
            
            p.pivotId = _index[p.pos];
            s.pivotWeight = _weight[p.pivotId];
            totalSum = s.pivotWeight + s.newLeftSum + s.newRightSum;
            if (_k == 2) {
                // last element of s.leftMedianWeight is the real median
                s.leftMedianWeight = totalSum / 2 + (totalSum % 2);  
                s.rightMedianWeight = totalSum - s.leftMedianWeight; 
                // if newSumLeft is contains the median weight!
                if (s.newLeftSum >= s.leftMedianWeight && s.leftMedianWeight > _leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum > s.rightMedianWeight && s.rightMedianWeight > _rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            } else if (_k == 1) {
                s.leftMedianWeight = totalSum / 4;
                // rightMedianWeight contains the correct first weight
                s.rightMedianWeight = totalSum - s.leftMedianWeight;
                if (s.newLeftSum > s.leftMedianWeight && s.leftMedianWeight > _leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum >= s.rightMedianWeight && s.rightMedianWeight > _rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            } else { // k = 3 - outward bias due to division
                s.rightMedianWeight = totalSum / 4;
                // leftMedianWeight contains the correct last weight
                s.leftMedianWeight = totalSum - s.rightMedianWeight;
                if (s.newLeftSum >= s.leftMedianWeight && s.leftMedianWeight > _leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum > s.rightMedianWeight && s.rightMedianWeight > _rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            }
        }

        // should never happen
        assert(false);
        return (0, 0, 0);
    }

    function _samePriceFix(
        uint256 _start,
        uint256 _end,
        int256 _direction,
        uint256 _sumInit,
        uint256[] memory _index,
        uint256[] memory _price,
        uint256[] memory _weight
    )
        internal pure returns (uint256, uint256)
    {
        uint256 weightSum = _sumInit;
        if ((int256(_start) - int256(_end)) * _direction >= 0) return (_start, _sumInit);
        uint256 thePrice = _price[_index[_start]];
        int256 storeIndex = int256(_start) + _direction;
        uint256 eltId;
        for (int256 i = int256(_start) + _direction; (i - int256(_end)) * _direction <= 0; i += _direction) {
            eltId = _index[uint256(i)];
            if (_price[eltId] == thePrice) {
                weightSum -= _weight[eltId];
                _swap(uint256(storeIndex), uint256(i), _index);
                storeIndex += _direction;
            }
        }
        return (uint256(storeIndex - _direction), weightSum);
    }

    function _closestPriceFix(
        uint256 _start,
        uint256 _end,
        uint256[] memory _index,
        uint256[] memory _price
    )
        internal pure returns (uint256)
    {
        if (_start == _end) {
            return _price[_index[_start]];
        }

        uint closestPrice = _price[_index[_start + 1]];
        uint newPrice;
        for (uint256 i = _start + 2; i <= _end; i++) {
            newPrice = _price[_index[i]];
            // assumes all the elements to the right of start are greater or equal 
            if (newPrice < closestPrice) {
                closestPrice = newPrice;
            }
        }
        return closestPrice;
    }
}
