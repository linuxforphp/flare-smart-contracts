// Unit tests for Delegation through DelegationMock contract
const {expectRevert, constants} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const Delegation = artifacts.require("DelegationMock");

const MAX_TOTAL_PCT_MSG = 'Max delegation bips exceeded';

contract(`Delegation.sol; ${getTestFile(__filename)}; Delegation unit tests`, async accounts => {
  // contains a fresh contract for each test
  let delegation;

  // Do clean unit tests by spinning up a fresh contract for each test
  beforeEach(async () => {
    delegation = await Delegation.new();
  });

  it("Should add a delegate by percentage", async() => {
    // Assemble
    // Act
    await delegation.addReplaceDelegateByPercent(accounts[1], 5000);
    // Assert
    const {found} = await delegation.tryFindDelegate(accounts[1]);
    assert(found);
  });

  it("Should add a delegate by amount", async() => {
    // Assemble
    // Act
    await delegation.addReplaceDelegateByAmount(accounts[1], 1000);
    // Assert
    const {found} = await delegation.tryFindDelegate(accounts[1]);
    assert(found);
  });

  it("Should update a delegate by percentage", async() => {
    // Assemble
    await delegation.addReplaceDelegateByPercent(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegateByPercent(accounts[1], 10000);
    // Assert
    const {found, amountOrBips} = await delegation.tryFindDelegate(accounts[1]);
    assert.equal(amountOrBips, 10000);
  });  

  it("Should update a delegate by amount", async() => {
    await delegation.addReplaceDelegateByAmount(accounts[1], 500);
    // Act
    await delegation.addReplaceDelegateByAmount(accounts[1], 1000);
    // Assert
    const {found, amountOrBips} = await delegation.tryFindDelegate(accounts[1]);
    assert.equal(amountOrBips, 1000);
  });

  it("Should add multiple delegates by percentage", async() => {
    // Assemble
    await delegation.addReplaceDelegateByPercent(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegateByPercent(accounts[2], 5000);
    // Assert
    assert.equal(await delegation.getDelegateTotal(), 10000);
  });

  it("Should add multiple delegates by amount", async() => {
    // Assemble
    await delegation.addReplaceDelegateByAmount(accounts[1], 100);
    // Act
    await delegation.addReplaceDelegateByAmount(accounts[2], 200);
    // Assert
    assert.equal(await delegation.getDelegateTotal(), 300);
  });

  it("Should should not find a delegate", async() => {
    // Assemble
    // Act
    await delegation.addReplaceDelegateByPercent(accounts[1], 5000);
    // Assert
    const {found} = await delegation.tryFindDelegate(accounts[2]);
    assert(!found);
  });

  it("Should not allow delegate by amount if already delegated by percentage", async() => {
    // Assemble
    await delegation.addReplaceDelegateByPercent(accounts[1], 5000);
    // Act
    let addPromise = delegation.addReplaceDelegateByAmount(accounts[1], 1000);
    // Assert
    await expectRevert.assertion(addPromise);
  });

  it("Should not allow delegate by percentage if already delegated by amount", async() => {
    // Assemble
    await delegation.addReplaceDelegateByAmount(accounts[1], 1000);
    // Act
    let addPromise = delegation.addReplaceDelegateByPercent(accounts[2], 5000);
    // Assert
    await expectRevert.assertion(addPromise);
  });

  it("Should remove delegate if zeroed", async() => {
    // Assemble
    await delegation.addReplaceDelegateByPercent(accounts[1], 5000);
    // Act
    await delegation.addReplaceDelegateByPercent(accounts[1], 0);
    // Assert
    const {found} = await delegation.tryFindDelegate(accounts[1]);
    assert(!found);
  });
  
  it("Should remove delegate", async() => {
    // Assemble
    await delegation.addReplaceDelegateByAmount(accounts[1], 1000);
    // Act
    let found = await delegation.tryRemoveDelegate(accounts[1]);
    // Assert
    assert(found);
    result = await delegation.tryFindDelegate(accounts[1]);
    assert(!result.found);
  });

  it("Should clear delegates", async() => {
    // Assemble
    await delegation.addReplaceDelegateByAmount(accounts[1], 100);
    await delegation.addReplaceDelegateByAmount(accounts[2], 200);
    // Act
    await delegation.clear();
    // Assert
    let result = await delegation.tryFindDelegate(accounts[1]);
    assert(!result.found);
    result = await delegation.tryFindDelegate(accounts[2]);
    assert(!result.found);
  });  

  it("Should allow no more than n delegates by percent", async() => {
    let maxDelegateCount = await delegation.MAX_DELEGATES_BY_PERCENT;
    if (accounts.length > maxDelegateCount) {
      // Assemble
      // Add maxDelegateCount delegates with 50 bips each
      for(var i = 1; i <= maxDelegateCount; i++) {
        await delegation.addReplaceDelegateByPercent(accounts[i], 50);
      }
      // Act
      let addPromise = delegation.addReplaceDelegateByPercent(accounts[maxDelegateCount+1], 50);
      // Assert
      await expectRevert(addPromise, "Max delegates exceeded");
    } else {
      console.log("Not enough accounts; test skipped.");
    }
  });

  it("Should not allow single delegation by percent > 10000 bips", async() => {
    // Assemble
    // Act
    let addPromise = delegation.addReplaceDelegateByPercent(accounts[1], 10001);
    // Assert
    await expectRevert.assertion(addPromise);
  });

  it("Should not allow delegation pct total > 10000 bips", async () => {
    // Assemble
    await delegation.addReplaceDelegateByPercent(accounts[1], 2000);
    // Act
    let delegatePromise = delegation.addReplaceDelegateByPercent(accounts[2], 9000);
    // Assert
    await expectRevert(delegatePromise, MAX_TOTAL_PCT_MSG);
  });  
});