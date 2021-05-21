// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { JournalEntry } from "../lib/AccountingStructs.sol";
import { FlareNetworkChartOfAccounts } from "../lib/FlareNetworkChartOfAccounts.sol";
import { FlareNetworkGeneralLedger } from "./FlareNetworkGeneralLedger.sol"; 
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @title Supply Accounting
 * @notice This contract computes various FLR supply totals.
 **/

contract SupplyAccounting {
    using SafeCast for int256;
    using SignedSafeMath for int256;

    FlareNetworkGeneralLedger public gl;

    constructor(FlareNetworkGeneralLedger _gl) {
        // TODO: No zero addresses please
        gl = _gl;
    }

    // inflatable supply = 
    //     GenesisToken + FtsoRewardInflationToken + FtsoRewardInflationValidatorPayable + BurnedToken(contra)
    function getInflatableSupplyBalance() external view returns (uint256) {
        int256 genesisTokenBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.GENESIS_TOKEN);
        int256 ftsoRewardInflationTokenBalance = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN);
        int256 ftsoRewardInflationValidatorPayableBalance = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE);
        int256 burnedTokenBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.BURNED_TOKEN);
        int256 inflatableSupplyBalance = genesisTokenBalance
            .add(ftsoRewardInflationTokenBalance)
            .add(ftsoRewardInflationValidatorPayableBalance)
            .add(burnedTokenBalance);
        return inflatableSupplyBalance.toUint256();
    }

    // on-chain supply = GenesisToken + FtsoRewardInflationToken + BurnedToken(contra)
    // TODO: Change visibility back to external once getCirculatingSupplyBalance has it's own implementation.
    function getOnChainSupplyBalance() public view returns (uint256) {
        int256 genesisTokenBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.GENESIS_TOKEN);
        int256 ftsoRewardInflationTokenBalance = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN);
        int256 burnedTokenBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.BURNED_TOKEN);
        int256 onChainSupplyBalance = genesisTokenBalance
            .add(ftsoRewardInflationTokenBalance)
            .add(burnedTokenBalance);
        return onChainSupplyBalance.toUint256();
    }

    function getUndistributedFtsoInflationBalance() external view returns (uint256) {
        int256 inflationExpectedBalance = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_EXPECTED);
        int256 earnedButNotClaimedBalance = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED);
        int256 claimedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_CLAIMED);
        int256 undistributedFtsoInflationBalance = inflationExpectedBalance
            .sub(earnedButNotClaimedBalance)
            .sub(claimedBalance);
        return undistributedFtsoInflationBalance.toUint256();
    }

    // TODO: Implement once buckets are defined within chart of accounts.
    function getCirculatingSupplyBalance() external view returns (uint256) {
        return getOnChainSupplyBalance();
    }
}
