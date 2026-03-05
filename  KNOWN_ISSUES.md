# Known Issues

### Missing PDA Enabled Check in `ClaimSetupManager.checkExecutorAndAllowedRecipient`

`checkExecutorAndAllowedRecipient` does not verify the Personal Delegation Account (PDA) `enabled` flag, allowing executors to direct rewards to a disabled PDA.

**Risk Assessment:** Rewards sent to a disabled PDA are not lost — the owner retains full access to the PDA and can withdraw funds at any time.

### `disableDelegationAccount` Does Not Fully Restrict PDA Usage

Disabling a Personal Delegation Account (PDA) only affects auto claiming. The PDA can still be used via `delegate`, `undelegateAll`, `withdraw`, etc.

**Risk Assessment:** This is intended behavior.

### Malicious Voter Could Block P-Chain Merkle Root Voting

A whitelisted voter can call `submitVote` multiple times with different `merkleRoot` values. When a root wins, `delete epochVotes[_epochId]` resets all votes. If the votes array is large enough, this operation may exceed the block gas limit and revert, preventing finalization of the winning merkle root.

**Risk Assessment:** Voters are trusted, whitelisted entities. Exploitation requires a trusted voter to act maliciously.

### Overflow Issue in `SafePct.mulDivRoundUp`

The `SafePct.mulDivRoundUp` method can overflow because Solidity versions prior to 0.8.x lack built-in arithmetic overflow checks.

**Risk Assessment:** This issue is not exploitable in our current use cases.
