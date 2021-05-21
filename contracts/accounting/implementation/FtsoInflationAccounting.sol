// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { Accounting } from "./Accounting.sol";
import { JournalEntry } from "../lib/AccountingStructs.sol";
import { FlareNetworkChartOfAccounts } from "../lib/FlareNetworkChartOfAccounts.sol";
import { FlareNetworkGeneralLedger } from "./FlareNetworkGeneralLedger.sol";
import { MintAccounting } from "./MintAccounting.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @title Ftso Inflation Accounting
 * @notice This contract implements accounting operations for the ftso inflation authorization/faucet contracts.
 **/

contract FtsoInflationAccounting is Accounting {
    using SafeCast for int256;
    using SignedSafeMath for int256;

    FlareNetworkGeneralLedger public gl;

    constructor(address _governance, 
        FlareNetworkGeneralLedger _gl)
        Accounting(_governance) {
        require(address(_gl) != address(0), "gl zero");
        gl = _gl;
    }

    // Make offsetting entries...we need to know what ftso inflation governanace has been approved for the annum,
    // but those assets cannot be recognized on the balance sheet until they are authorized by the passage of
    // time, which they will be by a debit entry to the minting authorized account.
    function inflateForAnnum(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit minting authorized account
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_EXPECTED, 
            debit: amountTWei, 
            credit: 0});
        // Credit ftso inflation validator payable account
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MINTING_UNAUTHORIZED, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    function authorizeMinting(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit minting authorized account
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, 
            debit: amountTWei, 
            credit: 0});
        // Credit ftso inflation validator payable account
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    // Recognize FLR as now being present on the network as a result of FTSO reward inflation
    function receiveMinting(uint256 amountTWei) external onlyPosters {
        // Move amount minted from a payable to equity
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Credit ftso reward inflation token equity account
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN, 
            debit: 0, 
            credit: amountTWei});
        // Debit ftso inflation validator payable account
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, 
            debit: amountTWei, 
            credit: 0});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    // Get the balance of FLR that have been minted due to Ftso reward inflation
    function getMintedInflationBalance() external view returns(uint256) {
        int256 inflationBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN);
        return inflationBalance.toUint256();
    }

    // Get the balance of FLR that have been minted or will be minted due to Ftso reward inflation
    function getInflationBalance() external view returns(uint256) {
        int256 mintedInflationBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN);
        int256 payableInflationBalance = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE);
        return mintedInflationBalance.add(payableInflationBalance).toUint256();
    }

    // Get the balance of FLR that are due to be minted by the validators due to Ftso reward inflation
    function getUnmintedInflationBalance() external view returns(uint256) {
        int256 unmintedInflationBalance = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE);
        return unmintedInflationBalance.toUint256();
    }
}
