import { VPTokenMockContract, VPTokenMockInstance } from "../../../typechain-truffle";
import { compareArrays, toBN } from "../../utils/test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
const {constants, expectRevert, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock") as VPTokenMockContract;

const ALREADY_DELEGATED_EXPLICIT_MSG = "Already delegated explicitly";
const ALREADY_DELEGATED_PERCENT_MSG = "Already delegated by percentage";


contract(`VPToken.sol; ${getTestFile(__filename)}; Check point unit tests`, async accounts => {
  // contains a fresh contract for each test
  let vpToken: VPTokenMockInstance;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    vpToken = await VPToken.new("A token", "ATOK");
  });

  it("Should return name", async () => {
    assert.equal(await vpToken.name(), "A token");
    assert.equal(await vpToken.symbol(), "ATOK");
  });

  it("Should be checkpointable", async() => {
    const b = [];
    // Assemble
    b[0] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 50);
    b[1] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 10);
    b[2] = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 5);
    // Act
    let balanceAtBlock0 = await vpToken.balanceOfAt(accounts[1], b[0]);
    let balanceAtBlock1 = await vpToken.balanceOfAt(accounts[1], b[1]);
    let balanceAtBlock2 = await vpToken.balanceOfAt(accounts[1], b[2]);
    let balanceAtNow = await vpToken.balanceOf(accounts[1]);
    // Assert
    assert.equal(balanceAtBlock0 as any, 0);
    assert.equal(balanceAtBlock1 as any, 50);
    assert.equal(balanceAtBlock2 as any, 60);
    assert.equal(balanceAtNow as any, 65);
  });

  it("Should be delegatable by percentage", async() => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, {from: accounts[1]});
    await vpToken.delegate(accounts[3], 50, {from: accounts[1]});
    // Act
    const { _delegateAddresses, _bips, _count, _delegationMode} = await vpToken.delegatesOf(accounts[1]) as any;
    // Assert
    assert.equal(_delegateAddresses[0], accounts[2]);
    assert.equal(_bips[0], 50);
    assert.equal(_delegateAddresses[1], accounts[3]);
    assert.equal(_bips[1], 50);
    assert.equal(_count, 2);
    assert.equal(_delegationMode, 1);
  });

  it("Should return value of delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 500, { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken.delegate(accounts[3], 300, { from: accounts[1] });
    // Act
    const value2_1 = await vpToken.votePowerFromToAt(accounts[1], accounts[2], blk1);
    const value2_n = await vpToken.votePowerFromTo(accounts[1], accounts[2]);
    const value3_1 = await vpToken.votePowerFromToAt(accounts[1], accounts[3], blk1);
    const value3_n = await vpToken.votePowerFromTo(accounts[1], accounts[3]);
    // Assert
    assert.equal(value2_1.toNumber(), 5);
    assert.equal(value2_n.toNumber(), 5);
    assert.equal(value3_1.toNumber(), 0);
    assert.equal(value3_n.toNumber(), 3);
  });

  it("Should return 0 for non-existent delegation", async () => {
    // Assemble
    await vpToken.delegate(accounts[2], 50, { from: accounts[1] });
    const blk1 = await web3.eth.getBlockNumber();
    await vpToken.delegate(accounts[3], 50, { from: accounts[1] });
    // Act
    const value = await vpToken.votePowerFromTo(accounts[1], accounts[5]);
    const value1 = await vpToken.votePowerFromToAt(accounts[1], accounts[5], blk1);
    // Assert
    assert.equal(value.toNumber(), 0);
    assert.equal(value1.toNumber(), 0);
  });

  it("Should be explicitly delegatable", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 75, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 15, { from: accounts[1] });
    // Act
    const values = [
      await vpToken.votePowerFromTo(accounts[1], accounts[2]),
      await vpToken.votePowerFromTo(accounts[1], accounts[3]),
      await vpToken.votePowerFromTo(accounts[1], accounts[5]),  // non-existent - should return 0
    ];
    const mode = await vpToken.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(values[0].toNumber(), 75);
    assert.equal(values[1].toNumber(), 15);
    assert.equal(values[2].toNumber(), 0);
    assert.equal(mode.toNumber(), 2);
  });

  it("Should undelegate all", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.delegate(accounts[2], 50, { from: accounts[1] });
    await vpToken.delegate(accounts[3], 50, { from: accounts[1] });
    // Act
    await vpToken.undelegateAll({ from: accounts[1] });
    // Assert
    const { _delegateAddresses, _bips, _count, _delegationMode } = await vpToken.delegatesOf(accounts[1]) as any;
    assert.equal(_count, 0);
    assert.equal(_delegationMode, 1);  // PERCENTAGE (mode should never be reset)
  });

  it("Should undelegate all explicit", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[4], 60, { from: accounts[1] });
    // Act
    await vpToken.undelegateAllExplicit([accounts[2], accounts[3], accounts[4]], { from: accounts[1] });
    // Assert
    const delegationMode = await vpToken.delegationModeOf(accounts[1]);
    const undelegated = await vpToken.undelegatedVotePowerOf(accounts[1]);
    assert.equal(delegationMode.toNumber(), 2); // AMOUNT (mode should never be reset)
    assert.equal(undelegated.toNumber(), 200);
  });

  it("Should partially undelegate all explicit", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[4], 60, { from: accounts[1] });
    // Act
    await vpToken.undelegateAllExplicit([accounts[2], accounts[3]], { from: accounts[1] });
    // Assert
    const delegationMode = await vpToken.delegationModeOf(accounts[1]);
    const undelegated = await vpToken.undelegatedVotePowerOf(accounts[1]);
    assert.equal(delegationMode.toNumber(), 2); // AMOUNT
    assert.equal(undelegated.toNumber(), 140);
  });

  it("Should not be allowed to call delegatesOf for explicit delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 75, { from: accounts[1] });
    // Act
    await expectRevert(vpToken.delegatesOf(accounts[1]), "delegatesOf does not work in AMOUNT delegation mode");
  });

  it("Should be allowed to call delegatesOf with no delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    // Act
    const { 0: delegates } = await vpToken.delegatesOf(accounts[1]);
    const mode = await vpToken.delegationModeOf(accounts[1]);
    // Assert
    assert.equal(delegates.length, 0);
    assert.equal(mode.toNumber(), 0);   // NOTSET
  });

  it("Should retrieve undelegated vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    let undelegatedVotePower = await vpToken.undelegatedVotePowerOf(accounts[1]);
    // Assert
    assert.equal(undelegatedVotePower as any, 50);
  });

  it("Should transfer vote power from address 1 to address 2", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    await vpToken.mint(accounts[2], 10);
    // Act
    await vpToken.transfer(accounts[2], 5, {from: accounts[1]});
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    let account2VP = await vpToken.votePowerOf(accounts[2]);
    assert.equal(account1VP as any, 45);
    assert.equal(account2VP as any, 15);
  });

  it("Should transfer balance from address 1 to address 2", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    await vpToken.mint(accounts[2], 10);
    // Act
    await vpToken.transfer(accounts[2], 5, {from: accounts[1]});
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    let account2balance = await vpToken.balanceOfAt(accounts[2], await web3.eth.getBlockNumber());
    assert.equal(account1balance as any, 45);
    assert.equal(account2balance as any, 15);
  });

  it("Should burn vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    let account1VP = await vpToken.votePowerOf(accounts[1]);
    assert.equal(account1VP as any, 45);
  });

  it("Should burn balance", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 50);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    let account1balance = await vpToken.balanceOfAt(accounts[1], await web3.eth.getBlockNumber());
    assert.equal(account1balance as any, 45);
  });

  it("Should revert delegating by percent when already delegated explicit", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    // Act
    let delegatePromise = vpToken.delegate(accounts[2], 1000, {from: accounts[1]});
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_EXPLICIT_MSG);
  });

  it("Should revert delegating explicit when already delegated by percent", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 1000, {from: accounts[1]});
    // Act
    let delegatePromise = vpToken.delegateExplicit(accounts[2], 50, {from: accounts[1]});
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_PERCENT_MSG);
  });

  it("Should revert undelegating explicit when delegated by percent", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 1000, { from: accounts[1] });
    // Act
    let delegatePromise = vpToken.undelegateAllExplicit([accounts[2]], { from: accounts[1] });
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_PERCENT_MSG);
  });

  it("Should revert undelegating by percent when delegated explicit", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 50, { from: accounts[1] });
    // Act
    let delegatePromise = vpToken.undelegateAll({ from: accounts[1] });
    // Assert
    await expectRevert(delegatePromise, ALREADY_DELEGATED_EXPLICIT_MSG);
  });

  it("Should sum minted vote power", async() => {
    // Assemble
    // Act
    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    // Assert
    assert.equal(await vpToken.votePower() as any, 30);
  });  

  it("Should net total vote power", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    // Act
    await vpToken.burn(5, {from: accounts[1]});
    // Assert
    assert.equal(await vpToken.votePower() as any, 25);
  });

  it("Should record historic vote power", async() => {
    // Assemble
    const b = [];
    let blockAfterFirstMinting = 0;

    await vpToken.mint(accounts[1], 10);
    await vpToken.mint(accounts[2], 20);
    b[blockAfterFirstMinting] = await web3.eth.getBlockNumber();

    // Act
    await vpToken.mint(accounts[2], 50);

    // Assert
    assert.equal(await vpToken.votePowerAt(b[blockAfterFirstMinting]) as any, 30);
  });

  it("Should leave total vote power alone when delegating", async() => {
    // Assemble
    await vpToken.mint(accounts[1], 20);
    // Act
    await vpToken.delegate(accounts[2], 5, {from: accounts[1]});
    // Assert
    assert.equal(await vpToken.votePower() as any, 20);
  });  

  it("Should correctly calculate undelegated vote power", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.mint(accounts[2], 50);
    await vpToken.mint(accounts[3], 20);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    await vpToken.delegate(accounts[3], 4000, { from: accounts[2] });
    // vote powers
    //      B     VP     UVP
    // 1   200    140    140
    // 2   50     90     30
    // 1   20     40     20
    // Assert
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 90);
    assert.equal((await vpToken.votePowerOf(accounts[3])).toNumber(), 40);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[2])).toNumber(), 30);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[3])).toNumber(), 20);
  });

  it("Should correctly handle historic undelegated vote power", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 20);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    // mint and delegate some more
    await vpToken.mint(accounts[1], 30);
    await vpToken.delegate(accounts[2], 9000, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 14);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 5);
  });

  it("Should correctly calculate undelegated vote power (explicit delegation)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.mint(accounts[2], 50);
    await vpToken.mint(accounts[3], 20);
    // Act
    await vpToken.delegateExplicit(accounts[2], 60, { from: accounts[1] });
    await vpToken.delegateExplicit(accounts[3], 20, { from: accounts[2] });
    // vote powers
    //      B     VP     UVP
    // 1   200    140    140
    // 2   50     90     30
    // 1   20     40     20
    // Assert
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 90);
    assert.equal((await vpToken.votePowerOf(accounts[3])).toNumber(), 40);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 140);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[2])).toNumber(), 30);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[3])).toNumber(), 20);
  });

  it("Should correctly handle historic undelegated vote power (explicit delegation)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 20);
    // Act
    await vpToken.delegateExplicit(accounts[2], 6, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    // mint and delegate some more
    await vpToken.mint(accounts[1], 30);
    await vpToken.delegateExplicit(accounts[2], 45, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 14);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 5);
  });

  it("Should revoke vote power", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.votePowerFromToAt(accounts[1], accounts[2], blockAfterDelegate1)).toNumber(), 0);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 200);
    assert.equal((await vpToken.votePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 200);
    assert.equal((await vpToken.votePowerOfAt(accounts[2], blockAfterDelegate1)).toNumber(), 0);
    
    assert.equal((await vpToken.votePowerFromTo(accounts[1], accounts[2])).toNumber(), 120);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 120);
  });

  it("Should revoke vote power (explicit)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegateExplicit(accounts[2], 60, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegateExplicit(accounts[2], 120, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    assert.equal((await vpToken.votePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 200);
    assert.equal((await vpToken.votePowerOfAt(accounts[2], blockAfterDelegate1)).toNumber(), 0);
    assert.equal((await vpToken.votePowerFromToAt(accounts[1], accounts[2], blockAfterDelegate1)).toNumber(), 0);
    assert.equal((await vpToken.undelegatedVotePowerOfAt(accounts[1], blockAfterDelegate1)).toNumber(), 200);
    //
    assert.equal((await vpToken.votePowerFromTo(accounts[1], accounts[2])).toNumber(), 120);
    assert.equal((await vpToken.undelegatedVotePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[1])).toNumber(), 180);
    assert.equal((await vpToken.votePowerOf(accounts[2])).toNumber(), 120);
  });

  it("Should not revoke vote power twice", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    await expectRevert(vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1, { from: accounts[1] }),
      "Already revoked");
  });

  it("Do nothing if revoking non-existent delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await vpToken.mint(accounts[1], 100);
    await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
    // revoke
    await vpToken.revokeDelegationAt(accounts[5], blockAfterDelegate1, { from: accounts[1] });
    // Assert
    const { 0: delegates } = await vpToken.delegatesOfAt(accounts[1], blockAfterDelegate1);
    compareArrays(delegates, [accounts[2]]);
  });

  it("Any undelegate should work with empty delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.undelegateAll({ from: accounts[1] });
    await vpToken.undelegateAllExplicit([], { from: accounts[1] });
    // Assert
    const mode = await vpToken.delegationModeOf(accounts[1]);
    assert.equal(mode.toNumber(), 0); // NOT_SET
  });

  it("Vote power delegation can be read with empty delegation (returns 0)", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const blk1 = await web3.eth.getBlockNumber();
    time.advanceBlock();
    // Act
    const value = await vpToken.votePowerFromTo(accounts[1], accounts[2]);
    const value1 = await vpToken.votePowerFromToAt(accounts[1], accounts[2], blk1);
    // Assert
    assert.equal(value.toNumber(), 0);
    assert.equal(value1.toNumber(), 0);
  });

  it("Any undelegate should work with empty delegation", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.undelegateAll({ from: accounts[1] });
    await vpToken.undelegateAllExplicit([], { from: accounts[1] });
    // Assert
    const mode = await vpToken.delegationModeOf(accounts[1]);
    assert.equal(mode.toNumber(), 0); // NOT_SET
  });

  it("Should not revoke vote power in present / future", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    // Act
    await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
    const blockAfterDelegate1 = await web3.eth.getBlockNumber();
    await time.advanceBlock();
    // Assert
    await expectRevert(vpToken.revokeDelegationAtNow(accounts[2], { from: accounts[1] }),
      "Revoke is only for the past, use undelegate for the present");
    await expectRevert(vpToken.revokeDelegationAt(accounts[2], blockAfterDelegate1 + 10, { from: accounts[1] }),
      "Revoke is only for the past, use undelegate for the present");
  });

  it("Should cache vote power and return same as uncached", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    // read original value
    const origVP = await vpToken.votePowerOfAt(accounts[1], block1);
    assert.equal(origVP.toNumber(), 200);
    // first time read cached value (read from original, store to cache)
    const cachedVP = await vpToken.votePowerOfAtCached.call(accounts[1], block1);
    assert.equal(cachedVP.toNumber(), 200);
    // must run without .call to actually store the cached value
    await vpToken.votePowerOfAtCached(accounts[1], block1);
    // second time read cached value (read from cache - should return the same)
    const cachedVP2 = await vpToken.votePowerOfAtCached.call(accounts[1], block1);
    assert.equal(cachedVP2.toNumber(), 200);
  });

  it("Should not call cached vote power in present / future", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    await expectRevert(vpToken.votePowerOfAtNowCached.call(accounts[1]),
      "Can only be used for past blocks");
    await expectRevert(vpToken.votePowerOfAtCached.call(accounts[1], block1 + 10),
      "Can only be used for past blocks");
  });

  it("Should cache total vote power and return same as uncached", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    await vpToken.mint(accounts[2], 40);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    const value = 240;
    // read original value
    const origVP = await vpToken.votePowerAt(block1);
    assert.equal(origVP.toNumber(), value);
    // first time read cached value (read from original, store to cache)
    const cachedVP = await vpToken.votePowerAtCached.call(block1);
    assert.equal(cachedVP.toNumber(), value);
    // must run without .call to actually store the cached value
    await vpToken.votePowerAtCached(block1);
    // second time read cached value (read from cache - should return the same)
    const cachedVP2 = await vpToken.votePowerAtCached.call(block1);
    assert.equal(cachedVP2.toNumber(), value);
  });

  it("Should not call cached total vote power in present / future", async () => {
    // Assemble
    await vpToken.mint(accounts[1], 200);
    const block1 = await web3.eth.getBlockNumber();
    // Act
    await time.advanceBlock();
    // Assert
    await expectRevert(vpToken.votePowerAtNowCached.call(),
      "Can only be used for past blocks");
    await expectRevert(vpToken.votePowerAtCached.call(block1 + 10),
      "Can only be used for past blocks");
  });

});