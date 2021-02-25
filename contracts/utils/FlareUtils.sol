// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

contract FlareUtils {

    uint256 constant BPS = 10000;

    struct Checkpoint {
        uint64 fromBlock;
        uint192 amount;
    }

    /// @dev Official record of token balances for each account
    struct CheckPoints {
        uint128 numCheckPoints;
        mapping(uint32 => Checkpoint) checkPoints;
    }

    function findCheckpoint(
        CheckPoints storage points,
        uint256 blockNumber
    ) internal returns (uint256 amount)
    {
        require(blockNumber < block.number, "future block");
        uint256 nCheckpoints = points.numCheckPoints;

        if (nCheckpoints == 0) {
            return 0;
        }

        // First check most recent balance
        if (points[nCheckpoints - 1].fromBlock <= blockNumber) {
            return points[nCheckpoints - 1].amount;
        }

        // Next check implicit zero balance
        if (points[0].fromBlock > blockNumber) {
            return 0;
        }

        uint256 lower = 0;
        uint256 upper = nCheckpoints - 1;
        while (upper > lower) {
            uint256 center = upper - (upper - lower) / 2; // ceil, avoiding overflow
            Checkpoint memory cp = points[center];
            if (cp.fromBlock == blockNumber) {
                return cp.amount;
            } else if (cp.fromBlock < blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return points[lower].amount;
    }
}
