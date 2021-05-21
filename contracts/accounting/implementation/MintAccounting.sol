// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { Accounting } from "./Accounting.sol";
import { JournalEntry } from "../lib/AccountingStructs.sol";
import { FlareNetworkChartOfAccounts } from "../lib/FlareNetworkChartOfAccounts.sol";
import { FlareNetworkGeneralLedger } from "./FlareNetworkGeneralLedger.sol"; 
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SignedSafeMath } from "@openzeppelin/contracts/math/SignedSafeMath.sol";

/**
 * @title Mint Accounting
 * @notice This contract implements mint accounting operations.
 **/

contract MintAccounting is Accounting {
    using SafeCast for int256;
    using SignedSafeMath for int256;

    FlareNetworkGeneralLedger public gl;

    constructor(address _governance, 
        FlareNetworkGeneralLedger _gl)
        Accounting(_governance) {
        require(address(_gl) != address(0), "gl zero");
        gl = _gl;
    }

    // Account for requesting validator to add supply to keeper contract
    function requestMinting(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit minted account with amount we are receiving.
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.MINTING_REQUESTED, 
            debit: amountTWei, 
            credit: 0});
        // Credit the authorized minting account
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.MINTING_AUTHORIZED, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    // Account for validator adding supply to keeper contract
    function receiveMinting(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit minted account with amount we are receiving.
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.MINTED, 
            debit: amountTWei, 
            credit: 0});
        // Credit the authorized minting account
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.MINTING_REQUESTED, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    // Account for keeper being the unsuspecting recipient of self-destruct proceeds
    function receiveSelfDestructProceeds(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit minted account with amount we are receiving.
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS, 
            debit: amountTWei, 
            credit: 0});
        // Credit the authorized minting account
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.GENESIS, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    function getKeeperBalance() external view returns(uint256 balanceTWei) {
        int256 mintedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED);
        int256 mintingWithdrawnBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_WITHDRAWN);
        int256 selfDestructProceeds = gl.getCurrentBalance(
            FlareNetworkChartOfAccounts.FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS);
        // mintingWithdrawnBalance is a contra asset account and will carry a negative balance.
        return mintedBalance.add(mintingWithdrawnBalance).add(selfDestructProceeds).toUint256();
    }

    // This is aggregated across all inflation types
    function getInflationBalance() external view returns(uint256) {
        // unminted but authorized inflation (all types) = MintingAuthorized
        int256 mintingAuthorizedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED);
        // minted inflation (all types) = Minted
        int256 mintedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED);
        // minting requested inflation (all types) = MintingRequested
        int256 mintingRequestedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED);
        return mintingAuthorizedBalance.add(mintedBalance).add(mintingRequestedBalance).toUint256();
    }

    // This is aggregated across all inflation types
    function getUnmintedInflationBalance() external view returns(uint256) {
        // unminted but authorized inflation (all types) = MintingAuthorized
        int256 mintingAuthorizedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED);
        // minting requested inflation (all types) = MintingRequested
        int256 mintingRequestedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED);
        return mintingAuthorizedBalance.add(mintingRequestedBalance).toUint256();
    }

    // This is aggregated across all inflation types
    function getMintedInflationBalance() external view returns(uint256) {
        // minted inflation (all types) = Minted
        int256 mintedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED);
        return mintedBalance.toUint256();
    }

    function getMintingRequested() external view returns(uint256) {
        return gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_REQUESTED).toUint256();
    }
}
