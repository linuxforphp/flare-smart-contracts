import { time } from "@openzeppelin/test-helpers";
import { 
  FlareDaemonMockInstance,
  InflationInstance,
  MockContractInstance, 
  SupplyInstance, 
  FtsoRewardManagerInstance, 
  SharingPercentageProviderMockInstance } from "../../../typechain-truffle";

const getTestFile = require('../../utils/constants').getTestFile;

const Inflation = artifacts.require("Inflation");
const MockContract = artifacts.require("MockContract");
const SharingPercentageProviderMock = artifacts.require("SharingPercentageProviderMock");
const FlareDaemonMock = artifacts.require("FlareDaemonMock");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const Supply = artifacts.require("Supply");

const BN = web3.utils.toBN;

contract(`Inflation.sol and Supply.sol; ${getTestFile(__filename)}; Inflation and Supply integration tests`, async accounts => {
  // contains a fresh contract set for each test
  let mockInflationPercentageProvider: MockContractInstance;
  let mockInflationSharingPercentageProvider: SharingPercentageProviderMockInstance;
  let inflation: InflationInstance;
  let mockFlareDaemon: FlareDaemonMockInstance;
  let supply: SupplyInstance;
  let ftsoRewardManager: FtsoRewardManagerInstance;
  const initialGenesisAmountWei = BN(15000000000).mul(BN(10).pow(BN(18)));
  const foundationSupplyWei = BN(2250000000).mul(BN(10).pow(BN(18)));
  const inflationBips = 1000;

  beforeEach(async() => {
    mockInflationPercentageProvider = await MockContract.new();
    mockFlareDaemon = await FlareDaemonMock.new();

    // Set up the ftsoRewardManager
    ftsoRewardManager = await FtsoRewardManager.new(
      accounts[0],
      3,
      0
    );

    // Set up mock inflation percentage provider
    const getAnnualPercentageBips = web3.utils.sha3("getAnnualPercentageBips()")!.slice(0,10);
    await mockInflationPercentageProvider.givenMethodReturnUint(getAnnualPercentageBips, inflationBips);

    // Set up mock one sharing percentage provider for 100%
    const sharingPercentages = [];
    sharingPercentages[0] = {inflationReceiver: ftsoRewardManager.address, percentBips: 10000};
    mockInflationSharingPercentageProvider = await SharingPercentageProviderMock.new(sharingPercentages);
    
    // Set up inflation...inflation sharing percentage provider will be reset.
    inflation = await Inflation.new(
      accounts[0],
      mockFlareDaemon.address,
      mockInflationPercentageProvider.address,
      mockInflationSharingPercentageProvider.address,
      0
    );

    // Wire up supply contract
    supply = await Supply.new(
      accounts[0],
      "0x0000000000000000000000000000000000000000",
      inflation.address,
      initialGenesisAmountWei,
      foundationSupplyWei,
      [ftsoRewardManager.address]
    );

    // Tell inflation about supply
    await inflation.setSupply(supply.address);
    // Register inflation to mock daemon contract so we can trigger inflation
    await mockFlareDaemon.registerToDaemonize(inflation.address);
    // Tell ftso reward manager about inflation
    await ftsoRewardManager.setContractAddresses(
      inflation.address, 
      (await MockContract.new()).address, 
      (await MockContract.new()).address);
  });

  describe("daily roll", async() => {
    it("Should authorize first day inflation and update inflatable balance on supply", async() => {
      // Assemble
      const totalInflationAuthorizedWei = initialGenesisAmountWei.mul(BN(inflationBips)).div(BN(10000)).div(BN(365));

      // Act
      await mockFlareDaemon.trigger();

      // Assert
      // Supply should have a new inflatable balance
      const expectedInflatableBalance = initialGenesisAmountWei.add(totalInflationAuthorizedWei);
      const inflatableBalance = await supply.getInflatableBalance();
      assert.equal(inflatableBalance.toString(), expectedInflatableBalance.toString());      
    });

    it("Should authorize first and second day inflation and update inflatable balance on supply", async() => {
      // Assemble
      const totalInflationAuthorizedWei1 = initialGenesisAmountWei.mul(BN(inflationBips)).div(BN(10000)).div(BN(365));
      // Double declining balance calculation
      const totalInflationAuthorizedWei2 = initialGenesisAmountWei.mul(BN(inflationBips)).div(BN(10000)).sub(totalInflationAuthorizedWei1).div(BN(364));
      // Total inflation authorized over two periods
      const totalInflationAuthorizedWei = totalInflationAuthorizedWei1.add(totalInflationAuthorizedWei2);
      // Force a block in order to get most up to date time
      await time.advanceBlock();
      // Get the timestamp for the just mined block
      const startTs = await time.latest();
      // First day
      await mockFlareDaemon.trigger();
      // Act
      // Advance time to next day
      await time.increaseTo(startTs.addn(86400));
      // Mine at least a block
      await time.advanceBlock();
      await mockFlareDaemon.trigger();
      // Assert
      // Supply should have a new inflatable balance for original supply plus two authorization periods
      const expectedInflatableBalance = initialGenesisAmountWei.add(totalInflationAuthorizedWei);
      const inflatableBalance = await supply.getInflatableBalance();
      assert.equal(inflatableBalance.toString(), expectedInflatableBalance.toString());      
    });
  });
});
