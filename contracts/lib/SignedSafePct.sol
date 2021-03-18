// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @dev Compute percentages safely without phantom overflows.
 *
 * Intermediate operations can overflow even when the result will always
 * fit into computed type. Developers usually
 * assume that overflows raise errors. `SignedSafePct` restores this intuition by
 * reverting the transaction when such an operation overflows for signed ints.
 *
 * Using this library instead of the unchecked operations eliminates an entire
 * class of bugs, so it's recommended to use it always.
 *
 * Can be combined with {SafeMath} and {SignedSafeMath} to extend it to smaller types, by performing
 * all math on `uint256` and `int256` and then downcasting.
 */
library SignedSafePct {
    using SafeMath for uint256;
    
    /**
     * @dev Returns `x` as a factor of `y` scaled to `z` without loss of precision for z <= 2**128
     *
     * Requirements:
     *
     * - intermediate operations must revert on overflow
     */
    function mulDiv (int256 xi, uint256 y, uint256 z) internal pure returns (int256)
    {
      require(z <= 2**128);

      uint256 x = uint(abs(xi));               // Permissive use: overflow not possible
      uint256 a = x.div(z);
      uint256 b = x.mod(z); // x = a * z + b

      uint256 c = y.div(z);
      uint256 d = y.mod(z); // y = c * z + d
      
      uint256 ir = (a.mul(b).mul(z)).add(a.mul(d)).add(b.mul(c)).add(b.mul(d).div(z));
      return xi >= 0 ? int(ir) : int(ir) * -1;  // Permissive use: intermediate result always contained within xi
    }

    function abs(int x) private pure returns (int) {
        return x >= 0 ? x : -x;
    }    
}