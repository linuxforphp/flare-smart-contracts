import {
  DataAvailabilityRewardManagerContract,
  DataAvailabilityRewardManagerInstance, FlareDaemonContract, FlareDaemonInstance, FtsoRewardManagerContract,
  FtsoRewardManagerInstance, GovernedBaseContract, InflationAllocationContract,
  InflationAllocationInstance, InflationContract,
  InflationInstance, SupplyContract,
  SupplyInstance
} from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";

const BN = web3.utils.toBN;


/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`inflation-contracts-fix.ts system tests`, async accounts => {
  let contracts: Contracts;
  let parameters: any;
  let GovernedBase: GovernedBaseContract;
  const SHOULD_HAVE_TRANSERED_GOVERNANCE = "Should have transfered governance";

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG);
    GovernedBase = artifacts.require("GovernedBase");
  });

  async function checkGovernance(contractName: string) {
    // Assemble
    const governedBase = await GovernedBase.at(contracts.getContractAddress(contractName));
    // Act
    const governance = await governedBase.governance();
    // Assert
    assert.equal(governance, parameters.governancePublicKey);
  }

  describe(Contracts.SUPPLY, async () => {
    let Supply: SupplyContract;
    let supply: SupplyInstance;

    beforeEach(async () => {
      Supply = artifacts.require("Supply");
      supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
    });

    it("Should have an inflatable balance > 0", async () => {
      // Assemble
      // Act
      const inflatableBalance = await supply.getInflatableBalance();
      // Assert
      assert(inflatableBalance.gt(BN(0)));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.SUPPLY);
    });
  });

  describe(Contracts.INFLATION_ALLOCATION, async () => {
    let InflationAllocation: InflationAllocationContract;
    let inflationAllocation: InflationAllocationInstance;
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let DataAvailabilityRewardManager: DataAvailabilityRewardManagerContract;
    let dataAvailabilityRewardManager: DataAvailabilityRewardManagerInstance;

    beforeEach(async () => {
      InflationAllocation = artifacts.require("InflationAllocation");
      inflationAllocation = await InflationAllocation.at(contracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
      if (parameters.inflationReceivers.indexOf("FtsoRewardManager") >= 0) {
        FtsoRewardManager = artifacts.require("FtsoRewardManager");
        ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
      }
      if (parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0) {
        DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");
        dataAvailabilityRewardManager = await DataAvailabilityRewardManager.at(contracts.getContractAddress(Contracts.DATA_AVAILABILITY_REWARD_MANAGER));
      }
    });

    it("Should have reward managers set", async () => {
      // Assemble
      // Act
      const sharingPctData = await inflationAllocation.getSharingPercentages();
      // console.log(sharingPctData);
      // Assert
      for (let i = 0; i < parameters.inflationReceivers.length; i++) {
        let receiverName = parameters.inflationReceivers[i];
        let receiverSharingBIPS = parameters.inflationSharingBIPS[i];
        let receiverAddress = "";        
        switch (receiverName) {
          case "FtsoRewardManager":
            receiverAddress = ftsoRewardManager.address
            break;
          case "DataAvailabilityRewardManager":
            receiverAddress = dataAvailabilityRewardManager.address
            break;
          default:
            throw Error(`Unknown inflation receiver name ${receiverName}`)
        }
        assert.equal(receiverAddress, sharingPctData[i].inflationReceiver);
        assert.equal(BN(receiverSharingBIPS), sharingPctData[i].percentBips);

      }
    });

    it("Should fetch an ftso annual inflation percentage", async () => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.lastAnnualInflationPercentageBips();
      // Assert
      assert(percentage.gt(BN(0)));
    });

    it("Should know about the Inflation", async () => {
      // Assemble
      // Act
      const inflation = await inflationAllocation.inflation();
      // Assert
      assert.equal(inflation, contracts.getContractAddress(Contracts.INFLATION));
    });

    it("Should new annual inflation percentage equal 10%", async () => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.annualInflationPercentagesBips(0);
      const percentage2 = await inflationAllocation.lastAnnualInflationPercentageBips();
      // Assert
      assert(percentage.eq(BN(1000)));
      assert(percentage2.eq(BN(1000)));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.INFLATION_ALLOCATION);
    });
  });

  describe(Contracts.INFLATION, async () => {
    let Inflation: InflationContract;
    let inflation: InflationInstance;
    let Supply: SupplyContract;
    let supply: SupplyInstance;
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    beforeEach(async () => {
      Inflation = artifacts.require("Inflation");
      inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
      Supply = artifacts.require("Supply");
      supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
      FlareDaemon = artifacts.require("FlareDaemon");
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should know about supply contract", async () => {
      // Assemble
      // Act
      const address = await inflation.supply();
      // Assert
      assert.equal(address, supply.address);
    });

    it("Should know about flare daemon contract", async () => {
      // Assemble
      // Act
      const address = await inflation.flareDaemon();
      // Assert
      assert.equal(address, flareDaemon.address);
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.INFLATION_ALLOCATION);
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;

    beforeEach(async () => {
      FtsoRewardManager = artifacts.require("FtsoRewardManager");
      ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    });

    it("Should know about the Inflation", async () => {
      // Assemble
      // Act
      const inflation = await ftsoRewardManager.getInflationAddress();
      // Assert
      assert.equal(inflation, contracts.getContractAddress(Contracts.INFLATION));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await ftsoRewardManager.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should know about the wNat", async () => {
      // Assemble
      // Act
      const wNat = await ftsoRewardManager.wNat();
      // Assert
      assert.equal(wNat, contracts.getContractAddress(Contracts.WNAT));
    });

    it("Should be activated", async () => {
      // Assemble
      const FtsoRewardManager = artifacts.require("FtsoRewardManager");
      const ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
      // Act
      const active = await ftsoRewardManager.active();
      // Assert
      assert(active);
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.INFLATION_ALLOCATION);
    });
  });

  describe(Contracts.DATA_AVAILABILITY_REWARD_MANAGER, async () => {
    it("Should be activated", async function() {
      if (!parameters.dataAvailabilityRewardManagerDeployed) return this.skip();
      // Assemble
      const DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");
      const dataAvailabilityRewardManager = await DataAvailabilityRewardManager.at(contracts.getContractAddress(Contracts.DATA_AVAILABILITY_REWARD_MANAGER));
      // Act
      const active = await dataAvailabilityRewardManager.active();
      // Assert
      assert(active);
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async function () {
      if (!parameters.dataAvailabilityRewardManagerDeployed) return this.skip();
      await checkGovernance(Contracts.DATA_AVAILABILITY_REWARD_MANAGER);
    });

    it("Should not have deployed", async function () {
      if (parameters.dataAvailabilityRewardManagerDeployed) return this.skip();
      try {
        await checkGovernance(Contracts.DATA_AVAILABILITY_REWARD_MANAGER);
        assert.fail('The expected Error was not thrown.');
      } catch (err: any) {
        assert.include(err.message, `${Contracts.DATA_AVAILABILITY_REWARD_MANAGER} not found`);
      }
    });
  });
});
