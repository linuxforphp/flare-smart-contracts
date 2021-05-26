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

    /**
     * @notice Authorize minting by posting the MINTING_AUTHORIZED account, balanced
     *   against the FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE account. Authorized minting
     *   forms a liability of the validators to the network to mint tokens for Ftso rewards
     *   at some point in the future.
     * @param amountTWei The amount to authorize.
     * @dev Note that amounts can be positive or negative. This is because authorization is
     *   done in advance, in chunks. At points in time, however, the GL will synchronize a close
     *   across the accounting system to negate all timing differences. A negative post to this
     *   method will claw back authorized minting.
     */
    function authorizeMinting(int256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        if (amountTWei >= 0) {
            // Debit minting authorized account
            journalEntries[0] = JournalEntry({
                accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, 
                debit: amountTWei.toUint256(), 
                credit: 0});
            // Credit ftso inflation validator payable account
            journalEntries[1] = JournalEntry({
                accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, 
                debit: 0, 
                credit: amountTWei.toUint256()});
        } else {
            // Credit minting authorized account
            journalEntries[0] = JournalEntry({
                accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, 
                debit: 0, 
                credit: (amountTWei * -1).toUint256()});
            // Debit ftso inflation validator payable account
            journalEntries[1] = JournalEntry({
                accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, 
                debit: (amountTWei * -1).toUint256(), 
                credit: 0});
        }
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
