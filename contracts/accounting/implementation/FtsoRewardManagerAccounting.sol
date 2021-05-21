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
 * @title Ftso Reward Manager Accounting
 * @notice This contract implements accounting operations for the ftso reward manager.
 **/

contract FtsoRewardManagerAccounting is Accounting {
    using SafeCast for int256;
    using SignedSafeMath for int256;
    
    FlareNetworkGeneralLedger public gl;

    constructor(address _governance, 
        FlareNetworkGeneralLedger _gl)
        Accounting(_governance) {
        require (address(_gl) != address(0), "gl zero");
        gl = _gl;
    }

    function receiveSupply(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit the ftso reward manager supply account with amount of minted FLR to withdraw
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY, 
            debit: amountTWei, 
            credit: 0});
        // Credit the minting withdrawn account
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.MINTING_WITHDRAWN, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    function rewardsEarned(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit the rewards earned account with funds disbursed but pending to be claimed
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED, 
            debit: amountTWei, 
            credit: 0});
        // Credit the supply account with funds disbursed for pending claims
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    function rewardsExpired(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Credit the rewards earned account with funds expired and will not be claimed
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED, 
            debit: 0, 
            credit: amountTWei});
        // Debit the supply account with funds expired ready for re-distribution
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY, 
            debit: amountTWei, 
            credit: 0});
        // Post the new journal entry
        gl.post(journalEntries);
    }

    function rewardsClaimed(uint256 amountTWei) external onlyPosters {
        // Open a new accounting journal entry
        JournalEntry[] memory journalEntries = new JournalEntry[](2);
        // Debit the rewards claimed account with funds claimed
        journalEntries[0] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_CLAIMED, 
            debit: amountTWei, 
            credit: 0});
        // Credit the earned account with funds paid to satisfy claim
        journalEntries[1] = JournalEntry({
            accountName: FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED, 
            debit: 0, 
            credit: amountTWei});
        // Post the new journal entry
        gl.post(journalEntries);        
    }

    function getRewardManagerBalance() external view returns(uint256) {
        int256 supplyBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SUPPLY);
        int256 earnedBalance = gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_EARNED);
        int256 selfDestructReceived = 
            gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_MANAGER_SELF_DESTRUCT_PROCEEDS);
        return supplyBalance.add(earnedBalance).add(selfDestructReceived).toUint256();
    }
}
