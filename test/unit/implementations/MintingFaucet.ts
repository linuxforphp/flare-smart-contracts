import { 
  FlareKeeperInstance,
  MintingFaucetMockInstance,
  MintAccountingInstance, 
  MockContractInstance } from "../../../typechain-truffle";

const {expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const FlareKeeper = artifacts.require("FlareKeeper");
const MintingFaucetMock = artifacts.require("MintingFaucetMock");
const MintAccounting = artifacts.require("MintAccounting");
const MockContract = artifacts.require("MockContract");

const BN = web3.utils.toBN;

contract(`MintingFaucet.sol; ${getTestFile(__filename)}; Minting faucet unit tests`, async accounts => {
  // contains a fresh contract for each test
  let mintingFaucet: MintingFaucetMockInstance;
  let mockWithdrawAmountProvider: MockContractInstance;
  let mockFlareKeeper: MockContractInstance;
  let mockRewardManager: MockContractInstance;
  let mockMintAccounting: MockContractInstance;
  let mintAccountingInterface: MintAccountingInstance;
  let mockGeneralLedger: MockContractInstance;
  let flareKeeperInterface: FlareKeeperInstance;
  let startTs: BN;

  beforeEach(async() => {
    mockWithdrawAmountProvider = await MockContract.new();
    mockFlareKeeper = await MockContract.new();
    mockRewardManager = await MockContract.new();
    mockMintAccounting = await MockContract.new();
    mockGeneralLedger = await MockContract.new();
    mintAccountingInterface = await MintAccounting.new(accounts[0], mockGeneralLedger.address);
    flareKeeperInterface = await FlareKeeper.new();

    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();
    mintingFaucet = await MintingFaucetMock.new(
      accounts[0],
      mockWithdrawAmountProvider.address,
      mockRewardManager.address,
      mockFlareKeeper.address,
      60,
      10,
      mockMintAccounting.address);
  });

  describe("setters", async() => {
    it.skip("Should test setters and governance", async() => {
    });
  });

  describe("request", async() => {
    it("Should request minting when request interval timeout expires", async() => {
      // Assemble
      // Time travel to be within mint request interval
      await time.increaseTo(startTs.addn(51));
      // Act
      const receipt = await mintingFaucet.keep();
      // Assert
      await expectEvent(receipt, "MintingRequested");
      await expectEvent.notEmitted(receipt, "RewardFundsWithdrawn");
    });
  
    it("Should not request minting when request interval timeout has not expired", async() => {
      // Assemble
      // Time travel to be just outside mint request interval
      await time.increaseTo(startTs.addn(49));
      // Act
      const receipt = await mintingFaucet.keep();
      // Assert
      await expectEvent.notEmitted(receipt, "MintingRequested");
      await expectEvent.notEmitted(receipt, "RewardFundsWithdrawn");
    }); 

    it("Should request minting of amount given by withdraw provider", async() => {
      // Assemble
      const getAmountTWei = web3.utils.sha3("getAmountTWei()")!.slice(0,10); // first 4 bytes is function selector
      await mockWithdrawAmountProvider.givenMethodReturnUint(getAmountTWei, 100);
      const requestMinting = mintAccountingInterface.contract.methods.requestMinting(100).encodeABI();
      // Time travel to be within mint request interval
      await time.increaseTo(startTs.addn(51));
      // Act
      const receipt = await mintingFaucet.keep();
      // Assert
      const invocationCount = await mockMintAccounting.invocationCountForCalldata.call(requestMinting);
      assert.equal(invocationCount.toNumber(), 1);
    });    
  });

  describe("withdraw", async() => {
    it("Should withdraw minting when withdraw interval timeout expires", async() => {
      // Assemble
      // Time travel to be within mint withdraw interval
      await time.increaseTo(startTs.addn(61));
      // Act
      const receipt = await mintingFaucet.keep();
      // Assert
      await expectEvent(receipt, "MintingRequested");
      await expectEvent(receipt, "RewardFundsWithdrawn");
    });
  
    it("Should not withdraw minting when withdraw interval timeout has not expired", async() => {
      // Assemble
      // Time travel to be just outside mint withdraw interval
      await time.increaseTo(startTs.addn(59));
      // Act
      const receipt = await mintingFaucet.keep();
      // Assert
      await expectEvent(receipt, "MintingRequested");
      await expectEvent.notEmitted(receipt, "RewardFundsWithdrawn");
    }); 

    it("Should withdraw minting of amount given by withdraw provider from keeper to reward manager", async() => {
      // Assemble
      const getAmountTWei = web3.utils.sha3("getAmountTWei()")!.slice(0,10); // first 4 bytes is function selector
      await mockWithdrawAmountProvider.givenMethodReturnUint(getAmountTWei, 100);
      const transferTo = flareKeeperInterface.contract.methods.transferTo(mockRewardManager.address, 100).encodeABI();
      // Time travel to be within mint request interval
      await time.increaseTo(startTs.addn(61));
      // Act
      const receipt = await mintingFaucet.keep();
      // Assert
      const invocationCount = await mockFlareKeeper.invocationCountForCalldata.call(transferTo);
      assert.equal(invocationCount.toNumber(), 1);
    });
  });
});
