import { 
  FtsoInflationAccountingInstance,
  FtsoRewardMintingFaucetInstance,
  MockContractInstance } from "../../../typechain-truffle";

const {expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const FtsoRewardMintingFaucet = artifacts.require("FtsoRewardMintingFaucet");
const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting");
const MockContract = artifacts.require("MockContract");

const BN = web3.utils.toBN;

contract(`FtsoRewardMintingFaucet.sol; ${getTestFile(__filename)}; Ftso reward minting faucet unit tests`, async accounts => {
  // contains a fresh contract for each test
  let ftsoRewardMintingFaucet: FtsoRewardMintingFaucetInstance;
  let mockWithdrawAmountProvider: MockContractInstance;
  let mockFlareKeeper: MockContractInstance;
  let mockRewardManager: MockContractInstance;
  let mockMintAccounting: MockContractInstance;
  let mockFtsoInflationAccounting: MockContractInstance;
  let mockFtsoRewardManagerAccounting: MockContractInstance;
  let mockGeneralLedger: MockContractInstance;
  let ftsoInflationAccountingInterface: FtsoInflationAccountingInstance;
  let startTs: BN;

  beforeEach(async() => {
    mockWithdrawAmountProvider = await MockContract.new();
    mockFlareKeeper = await MockContract.new();
    mockRewardManager = await MockContract.new();
    mockMintAccounting = await MockContract.new();
    mockGeneralLedger = await MockContract.new();
    mockFtsoInflationAccounting = await MockContract.new();
    mockFtsoRewardManagerAccounting = await MockContract.new();
    ftsoInflationAccountingInterface = await FtsoInflationAccounting.new(accounts[0], mockGeneralLedger.address);

    // Force a block in order to get most up to date time
    await time.advanceBlock();
    // Get the timestamp for the just mined block
    startTs = await time.latest();
    ftsoRewardMintingFaucet = await FtsoRewardMintingFaucet.new(
      accounts[0],
      mockWithdrawAmountProvider.address,
      mockRewardManager.address,
      mockFlareKeeper.address,
      60,
      10,
      mockMintAccounting.address,
      mockFtsoInflationAccounting.address
    );
  });

  describe("withdraw", async() => {
    it("Should account for ftso reward topup when withdrawing minting from keeper", async() => {
      // Assemble
      const getAmountTWei = web3.utils.sha3("getAmountTWei()")!.slice(0,10); // first 4 bytes is function selector
      await mockWithdrawAmountProvider.givenMethodReturnUint(getAmountTWei, 100);
      const receiveMinting = ftsoInflationAccountingInterface.contract.methods.receiveMinting(100).encodeABI();
      // Time travel to be within mint request interval
      await time.increaseTo(startTs.addn(61));
      // Act
      const receipt = await ftsoRewardMintingFaucet.keep();
      // Assert
      const receiveMintingInvocationCount = await mockFtsoInflationAccounting.invocationCountForCalldata.call(receiveMinting);
      assert.equal(receiveMintingInvocationCount.toNumber(), 1);
    });
  });
});
