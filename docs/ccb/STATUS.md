# Chuck Benedict Status Log

[![Node.js CI](https://github.com/chuckb/fasset/actions/workflows/push.yaml/badge.svg)](https://github.com/chuckb/fasset/actions/workflows/push.yaml)

## Feb 15, 2021
I attempted to implement some foundational code for a basic ERC20 token without allowances, but with a history implementation that mimics the MiniMe token, instead of using some already stood up implementation from OpenZeppelin. I also tried to compose the interfaces in some logical way. Then I also took care to deal with overflow situations from sample code and blogs I found (and borrowed). This still needs work. Finally, I started to code up some tests to exercise the BasicHistoryToken contract. The tests currently don't run due to dependency problems, and I am trying to sort out the various testing approaches that can be used.

Tomorrow, I intend to get tests working and then to take a stab at implementing the FAssetToken methods. But at least current project compiles and migrates. So that is a start.

## Feb 16, 2021
BasicHistoryToken unit tests are now running. Tokens can be generated across accounts. Total supply can be obtained. Tokens can be transferred.
### TODO
- Add BHT unit tests that specifically address history storing and fetching
- Add some negative tests (still pending)
- Spin up FAssetToken with some voting fun
### Done
- Historical balance and supply unit tests added.
- Reviewed technical approach for FAssetToken with Ilan.
- Started FAssetToken contract.

## Feb 17, 2021
First commit of FAssetToken made. Coding started for maintaining delegation percents.
### TODO
- Test delegate percent maintenance.
- Code delegate voting power.
- Integrate transfer logic to move voting power.
- Complete automated unit testing for all the above.
### Done
- Test delegate percent maintenance complete.
- Allocate voting power routine coded (math is trash...needs work)
- Generate tokens allocates voting power (one test completes...more needed)
### Not Done
- Destroy tokens not tested at all, and reallocation not coded
- Transfer routine override needed to move voting power.
- Delegate percent maintenance does not yet reallocate voting.

## Feb 18, 2021
All stage 1 features coded and basic unit tests written to demonstrate functional code. Note that transfer logic test in `fasset-voting-xfer-unit.js` contains a step by step state representation of transfer. It should be reviewed to ensure my understanding of desired outcome is correct.
### Not Done
- Destroy tokens not tested at all.
- Add some negative tests for basic token.
- Math, math, math: overflow, underflow, and rounding. Carefully review.
- Casting. Add protection to catch casting errors.
- More transfer logic test cases.
- Permission for protected methods.

## Feb 19, 2021
Unsafe math operations reviewed and remediated.
### Done
- Standards document created to address how the project might approach safe math to assist/speed up security audits. Please review, comment and/or approve.
- All math operations in BasicHistoryToken and FAssetToken reviewed and remediated for safety.
- Casting reviewed for safety.
### Not Done
- Destroy tokens not tested at all.
- Add some negative tests for basic token.
- More transfer logic test cases.
- Permission for protected methods.
- Add some tests to prove math safety.

## Feb 20, 2021
A relationship edit was added to BasicHistoryToken transfer to prevent more value being transferred than exists at source. Other negative tests (some literal)/edge cases added.

Project can now be tested from a basic node environment with `npm test`. This will enable easy continuous integration setup.
### Done
- Cannot transfer more value than source contains.
- Added tests to check for transfer and delegate function events.
- Set up `npm` package with complete dependencies so that project is ready for CI.
- Added github CI workflow to run upon push. Workflow will run `npm run test-with-coverage`. Output can be seen in github Actions tab upon checkin. Artifacts could be saved off for audit/review (but are not currently). Currently, just result from run is viewable within github job output. Coverage directory (excluded from checkin) does produce very nice html coverage reports showing code without test coverage.
### Not Done
- Destroy tokens not tested at all.
- Destroy token override (to remove vote power) in FAssetToken missing.
- Add additional transfer logic test cases.
- Permission for protected methods.
- Add some tests to prove math safety.
- Add badge for coveralls.

## Feb 22, 2021
Summarized todos from code review conversation. Abstracted checkpoint contracts.
## Done
- Compiler version references changed 0.7.6.
- Packed structures.
- delegate function should be external.
- _allocateVotePower: removed unconventional subtraction.
- Updated to absolute versions in package.json.
- Completed checkpoint contract abstractions with unit tests.
### TODO
- Not Done items from Feb 20.
- Pull in ERC20 from Zeppelin.
- Refactor ERC20, checkpoints, and voting into DelegateToken.

## Feb 23-24, 2021
### Done
- Factored out local use of OpenZeppelin contracts and pulled in library as a package.
- Added CheckPointToken, which is the mintable open zeppelin ERC20PresetMinterPauser token with checkpoints.
- Added DelegateToken.
- Refactored tests.
- OpenZep Compiler warnings ditched (ignored really).
- DelegateToken size issue dealt with with optimization at present.
- Composition and separation of concerns of DelegateToken finally looks right (and there is not much there any more).
### Not Done
- Switch environment to hardhat. Attempt made but cannot run due to error. Need help.
- WFLR token.
- More DelegateToken and CheckPoint* testing. Need to review code coverage reports since refactor.

## Feb 25, 2021
### Done
- Code review feedback incorporated.
- Switch tooling to hardhat and yarn. I figured out linking problem. See link statements in VPToken tests.
- Researched contract size for VPToken. When compiled/instrumented for test coverage, 24K size is exceeded. Otherwise, it is fine.

## Feb 26, 2021
### Not Done
- Reviewed contract and returned feedback to Hugo. Awaiting return of minor edits from Hugo in order to sign.
### Done
- WFLR added. I used WETH9 as a model, but reimplemented as an Open Zep ERC20 token. Some tests added to make sure I knew what was going on.

## Feb 27, 2021
### Done
- Moved wrapped behavior into abstract contract. Adjusted WFLR to inherit behavior.
- Created directory taxonomy to better organize contracts.
- Refactored CheckPoint contracts into libraries.
### Not Done
- Refactor CheckPoint unit tests into Solidity tests.

## Feb 28, 2021
### Done
- Added back in unit tests (with mock contracts) for CheckPoint* libs.
- Reviewed and remediated libs to ensure internal fns were used. No use case so far should require external contract calls for libs created.

## Mar 1, 2021
### Done
- Removed copyright notices.
- Reviewed contract edits from Hugo, signed, and returned executed version.
- Removed Wrappable contract.
- Added gas timing to a vote power test in order to measure performance deltas factoring out cross-contract calls to CheckPoint*. For test "Should transfer vote power when tokens are transferred", with remote CheckPoint* contracts, 4,807,709 total gas used. With performance branch, 1,436,343 total gas used. This is almost a 4x improvement.
- Merged performance branch into main.
### To do
- Began work on delegateExplicit

## March 2, 2021
### Done
- Refactored vote power delegation-related code into its own library, in preparation for many more business rules dealing with vote power delegation/undelegation.
- Added undelegate all functionality for delegation by percentage.
- Added capability for delegation logic to recognize whether delegation is by percentage or explicit amount.
- Added logic to undelegate all when delegation mode is being changed.
- Split unit tests between percent and explicit delegation.
- Added explicit delegation unit tests.
### Not done
- Undelegate all for explicit delegations.
- More unit tests for excess explicit delegations. More unit tests for attempting to cross pct -> explicit and explicit -> pct.
- getDelegationToAt

## March 3, 2021
### Done
- Some onboarding started.
- undelegateAll, delegateExplicit , and undelegatedVotePowerOf of VPToken complete.
- revoke requirement review started.
- Test names now include contract and test file name.
### Not done
- getDelegationToAt
- revokeDelegationAt

## March 4, 2021
- Started revokeDelegationAt; created a test to confirm what needs to be built.

## March 5, 2021
- First commit for revokeDelegationToAt implementation. Test does not yet pass.

## March 7, 2021
- Complete refactor for revokeDelegationToAt complete. Testing remains.

## March 8, 2021
### Done
- Old tests now pass.
- Revoke test now passes.
### Not Done
- Review and incorporate any feedback.
- Some duplicate code to be DRYed up.
- More tests need to be implemented...specifically inserting into checkpoint array when revoking at a checkpoint that does not exist.
- Review TODOs in code.
- Merge into main repo.

## March 9, 2021
### Done
- Add Revoke event.
- Change Delegate event to show vote power and block number, as opposed to percent or delegation amount, which is not important to a validator. They want to know about the vote power moving around the system.
- Reviewed all delegate/undelegate places in code to make sure Delegate event was being fired properly.
- Modified revoke checkpoint logic to NOT insert a checkpoint for a revokation where the exact block is not found. Instead, greatest block found less than revoke block is updated.
- Completely documented and alphabetized contract/library methods.
- Resolved all pull comments.
- DRYed up duplicate binary search logic.
- Merged all branches into private main repo branch. Ready to merge into gitlab.
### Not done
- Add more tests to verify Delegate event emission.

## March 10, 2021
- Merge private repo into Flare's flare-smart-contracts repo. Branch is ccb/vptoken. It does not compile due to conflicts. Next commit will remove conflicts.
- Project builds in my branch. I rearranged code, corrected typos, or worst case, commented out offending code or removed offending files. This will need review.

## March 11, 2021
- Added back in FAssetToken according to thoughts presented to Ilan.
- Changed VPToken to inherit from ERC20.
- Adjusted VPToken tests to target VPTokenMock so that minting could be used in tests.
- Added VotePowerMock and associated unit tests. Used OZ helpers. Note that version had to be incremented to support expectRevert without errant warning.
- Now using OZ test helpers.
- Reviewed an answered merge feedback.
- Added DelegationMock and unit tests.
- Reorganized test directory to match source directory structure.

## March 12, 2021
- Finished off VPToken test suite reorg. Subject to any additional feedback, VPToken is ready to merge into master.

## March 16, 2021
- Fixed build command(s) issue from VSCode.
- Reworked internal storage of delegation. All tests passing.
