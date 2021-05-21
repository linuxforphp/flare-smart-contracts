// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {CheckPointHistory} from "./CheckPointHistory.sol";

library CheckPointHistoryCache {
    using SafeMath for uint256;
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    
    struct CacheState {
        // mapping blockNumber => (value + 1)
        mapping (uint256 => uint256) cache;
    }
    
    function valueAt(
        CacheState storage self,
        CheckPointHistory.CheckPointHistoryState storage checkPointHistory,
        uint256 blockNumber
    ) internal returns (uint256 value) {
        // is it in cache?
        uint256 cachedValue = self.cache[blockNumber];
        if (cachedValue != 0) {
            return cachedValue - 1;
        }
        // read from checkPointHistory
        uint256 historyValue = checkPointHistory.valueAt(blockNumber);
        self.cache[blockNumber] = historyValue.add(1);  // store to cache (add 1 to differentiate from empty)
        return historyValue;
    }
}
