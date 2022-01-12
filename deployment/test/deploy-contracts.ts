import { constants, time } from '@openzeppelin/test-helpers';
import { pascalCase } from 'pascal-case';
import { waitFinalize3 } from "../../test/utils/test-helpers";
import {
  AddressUpdaterContract,
  AddressUpdaterInstance,
  AssetTokenContract, AssetTokenInstance, DataAvailabilityRewardManagerContract,
  DataAvailabilityRewardManagerInstance, DummyAssetMinterContract, FlareDaemonContract, FlareDaemonInstance, FtsoContract,
  FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance, FtsoRewardManagerContract,
  FtsoRewardManagerInstance, InflationAllocationContract,
  InflationAllocationInstance, InflationContract,
  InflationInstance, SupplyContract,
  SupplyInstance, WNatContract
} from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";
import { findAssetFtso, findFtso } from '../scripts/deploy-utils';

const parameters = require(`../chain-config/${process.env.CHAIN_CONFIG}.json`)
const BN = web3.utils.toBN;

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`deploy-contracts.ts system tests`, async accounts => {
  let contracts: Contracts;
  let deployerAccountAddress = accounts[0];

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
  });

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

    it("Should new annual inflation percentage equal 10%", async () => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.annualInflationPercentagesBips(0);
      const percentage2 = await inflationAllocation.lastAnnualInflationPercentageBips();
      // Assert
      assert(percentage.eq(BN(1000)));
      assert(percentage2.eq(BN(1000)));
    });
  });

  describe(Contracts.FLARE_DAEMON, async () => {
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    beforeEach(async () => {
      FlareDaemon = artifacts.require("FlareDaemon") as FlareDaemonContract;
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should be daemonizing", async () => {
      // Assemble
      // Act
      if (flareDaemon.address != parameters.flareDaemonAddress) {
        await flareDaemon.trigger();
      }
      const systemLastTriggeredAt = await flareDaemon.systemLastTriggeredAt();
      // Assert
      assert(systemLastTriggeredAt.toNumber() > 0);
    });

    it("Should have block holdoff set", async () => {
      // Assemble
      // Act
      const blockHoldoff = await flareDaemon.blockHoldoff();
      // Assert
      assert.equal(blockHoldoff.toString(), parameters.flareDaemonGasExceededHoldoffBlocks.toString());
    })
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    beforeEach(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should have a reward epoch if rewarding started and being daemonized by daemon", async () => {
      // Assemble
      const startTs = await time.latest();
      const rewardEpochStartTs = (await ftsoManager.getRewardEpochConfiguration())[0];
      if (rewardEpochStartTs.lt(startTs) && await ftsoManager.active()) {
        // Act
        const startBlock = (await ftsoManager.getRewardEpochData(0)).votepowerBlock;
        // Assert
        // If the daemon is calling daemonize on the RewardManager, then there should be
        // an active reward epoch.
        assert(startBlock.toNumber() != 0);
      }
    });

    it("Should know about PriceSubmitter", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.priceSubmitter();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });

    it("Should know about FtsoRegistry", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.getFtsoRegistry();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    });

    it("Should know about FtsoRewardManager", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.getFtsoRewardManager();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    });

    it("Should know about CleanupBlockNumberManager", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.getCleanupBlockNumberManager();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
    });

    it("Should know about VoterWhitelister", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.getVoterWhitelister();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    });

    it("Should know about AddressUpdater", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.addressUpdater();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    });

    it("Should know about Supply", async () => {
      // Assemble
      // Act
      const address = await ftsoManager.getSupply();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.SUPPLY));
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

    // TODO: This test is almost unnecessary immediatelly after deployment on Flare node since
    // reward epoch starts with delay. 
    // It also does not work with deployment on hardhat network.
    // Skipped for now
    it.skip("Should have recognized inflation set if rewarding started", async () => {
      // Assemble
      const rewardEpochStartTs = await inflation.rewardEpochStartTs();
      const startTs = await time.latest();
      // Act
      try {  // This is unnecessary on Flare chain and it fails. It is relevant on hardhat chain.
        await flareDaemon.trigger();
      } catch (e) {
        console.log(e)
      }
      // Assert
      if (rewardEpochStartTs.lt(startTs)) {
        const { 0: recognizedInflationWei } = await inflation.getCurrentAnnum() as any;
        assert(BN(recognizedInflationWei).gt(BN(0)));
      }
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
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;

    beforeEach(async () => {
      FtsoRewardManager = artifacts.require("FtsoRewardManager");
      ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await ftsoRewardManager.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
  });

  describe(Contracts.WNAT, async () => {
    it("Should accept deposits", async () => {
      // Assemble
      const WNAT = artifacts.require("WNat") as WNatContract;
      const wnat = await WNAT.at(contracts.getContractAddress(Contracts.WNAT));
      const openingBalance = await wnat.balanceOf(deployerAccountAddress)
      // Act
      await waitFinalize3(deployerAccountAddress, () => wnat.deposit({ from: deployerAccountAddress, value: BN(10) }));
      // Assert
      const balance = await wnat.balanceOf(deployerAccountAddress)
      assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });
  });

  if (parameters.deployDummyXAssetTokensAndMinters) {
    for (let asset of parameters.assets) {
      describe(`Dummy${asset.xAssetSymbol}minter`, async () => {
        it("Should mint ", async () => {
          // Assemble
          const DummyAssetMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
          const dummyAssetMinter = await DummyAssetMinter.at(contracts.getContractAddress(`Dummy${asset.xAssetSymbol}minter`));
          const FAsset = artifacts.require("AssetToken") as AssetTokenContract;
          const fAsset = await FAsset.at(contracts.getContractAddress(asset.xAssetSymbol));
          const openingBalance = await fAsset.balanceOf(accounts[1])
          // Act
          await waitFinalize3(accounts[0], () => dummyAssetMinter.mintRequest(10, accounts[1], constants.ZERO_ADDRESS));
          // Assert
          const balance = await fAsset.balanceOf(accounts[1])
          assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
        });
      });
    }
  }

  if (parameters.deployNATFtso) {
    describe(Contracts.FTSO_WNAT, async () => {
      let FtsoWnat: FtsoContract;
      let ftsoWnat: FtsoInstance;

      beforeEach(async () => {
        FtsoWnat = artifacts.require("Ftso");
        ftsoWnat = await FtsoWnat.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
      });

      if (parameters.deployNATFtso) {
        it("Should be on oracle for WNAT", async () => {
          // Assemble
          // Act
          const address = await ftsoWnat.wNat();
          // Assert
          assert.equal(address, contracts.getContractAddress(Contracts.WNAT));
        });
      }

      it("Should be managed", async () => {
        // Assemble
        // Act
        const ftsoManager = await ftsoWnat.ftsoManager();
        // Assert
        assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      });

      it("Should know about PriceSubmitter", async () => {
        // Assemble
        // Act
        const priceSubmitter = await ftsoWnat.priceSubmitter();
        // Assert
        assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
      });

      it("Should represent ftso decimals correctly", async () => {
        // Assemble
        // Act
        const decimals = await ftsoWnat.ASSET_PRICE_USD_DECIMALS();
        // Assert
        assert.equal(decimals.toNumber(), parameters.nativeFtsoDecimals);
      });

      for (let asset of parameters.NATMultiAssets) {
        it(`Should know about ${asset} Asset FTSO`, async () => {
          // Assemble
          // Act
          const found = await findAssetFtso(ftsoWnat, contracts.getContractAddress(`Ftso${pascalCase(asset)}`));
          // Assert
          assert(found);
        });
      }
    });
  }

  for (let asset of parameters.assets) {
    describe(pascalCase(`FTSO ${asset.assetSymbol}`), async () => {
      let FtsoAsset: FtsoContract;
      let ftsoAsset: FtsoInstance;

      beforeEach(async () => {
        FtsoAsset = artifacts.require("Ftso");
        ftsoAsset = await FtsoAsset.at(contracts.getContractAddress(`Ftso${pascalCase(asset.assetSymbol)}`));
      });
      
      it(`Should be on oracle for ${asset.assetSymbol}`, async () => {
        // Assemble
        // Act
        const address = await ftsoAsset.getAsset();
        // Assert
        if (parameters.deployDummyXAssetTokensAndMinters) {
          assert.equal(address, contracts.getContractAddress(asset.xAssetSymbol));
        } else {
          assert.equal(address, constants.ZERO_ADDRESS);
        }
      });

      it("Should be managed", async () => {
        // Assemble
        // Act
        const ftsoManager = await ftsoAsset.ftsoManager();
        // Assert 
        assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      });

      it("Should know about PriceSubmitter", async () => {
        // Assemble
        // Act
        const priceSubmitter = await ftsoAsset.priceSubmitter();
        // Assert
        assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
      });

      it("Should represent ftso decimals correctly", async () => {
        // Assemble
        // Act
        const decimals = await ftsoAsset.ASSET_PRICE_USD_DECIMALS();
        // Assert
        assert.equal(decimals.toNumber(), asset.ftsoDecimals);
      });
    });
  }

  if (parameters.deployDummyXAssetTokensAndMinters) {
    for (let asset of parameters.assets) {
      describe(`${asset.xAssetSymbol}`, async () => {
        let FAsset: AssetTokenContract;
        let fAsset: AssetTokenInstance;

        beforeEach(async () => {
          FAsset = artifacts.require("AssetToken");
          fAsset = await FAsset.at(contracts.getContractAddress(`${asset.xAssetSymbol}`));
        });

        it(`Should be an asset representing ${asset.assetSymbol}`, async () => {
          // Assemble
          // Act
          const symbol = await fAsset.symbol();
          // Assert
          assert.equal(symbol, asset.xAssetSymbol);
        });

        it(`Should represent ${asset.assetSymbol} decimals correctly`, async () => {
          // Assemble
          // Act
          const decimals = await fAsset.decimals();
          // Assert
          assert.equal(decimals.toNumber(), asset.assetDecimals);
        });
      });
    }
  }

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    beforeEach(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    for (let asset of parameters.assets) {
      it(`Should be managing an ${asset.assetSymbol} FTSO`, async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoManager, contracts.getContractAddress(`Ftso${pascalCase(asset.assetSymbol)}`));
        // Assert
        assert(found);
      });
    }

    if (parameters.deployNATFtso) {
      it("Should be managing a WNAT FTSO", async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoManager, contracts.getContractAddress(Contracts.FTSO_WNAT));
        // Assert
        assert(found);
      });
    }

    it("Should have goveranance parameters set", async () => {
      // Assemble
      const settings = await ftsoManager.getGovernanceParameters();
      // Act
      const maxVotePowerNatThresholdFraction = settings[0];
      const maxVotePowerAssetThresholdFraction = settings[1];
      const lowAssetThresholdUSDDec5 = settings[2];
      const highAssetThresholdUSDDec5 = settings[3];
      const highAssetTurnoutThresholdBIPS = settings[4];
      const lowNatTurnoutThresholdBIPS = settings[5];
      // Assert
      assert.equal(maxVotePowerNatThresholdFraction.toNumber(), parameters.maxVotePowerNatThresholdFraction);
      assert.equal(maxVotePowerAssetThresholdFraction.toNumber(), parameters.maxVotePowerAssetThresholdFraction);
      assert.equal(lowAssetThresholdUSDDec5.toNumber(), parameters.lowAssetThresholdUSDDec5);
      assert.equal(highAssetThresholdUSDDec5.toNumber(), parameters.highAssetThresholdUSDDec5);
      assert.equal(highAssetTurnoutThresholdBIPS.toNumber(), parameters.highAssetTurnoutThresholdBIPS);
      assert.equal(lowNatTurnoutThresholdBIPS.toNumber(), parameters.lowNatTurnoutThresholdBIPS);
    });
  });

  describe(Contracts.ADDRESS_UPDATER, async () => {
    let AddressUpdater: AddressUpdaterContract;
    let addressUpdater: AddressUpdaterInstance;

    beforeEach(async () => {
      AddressUpdater = artifacts.require("AddressUpdater");
      addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    });

    it("Should know about all contracts", async () => {
      let contractNames = [Contracts.STATE_CONNECTOR, Contracts.FLARE_DAEMON, Contracts.PRICE_SUBMITTER, Contracts.WNAT,
        Contracts.FTSO_REWARD_MANAGER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER,
        Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION, Contracts.INFLATION, Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER];

      if (parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0) {
        contractNames.push(Contracts.DATA_AVAILABILITY_REWARD_MANAGER);
      }
    
      if (parameters.deployDistributionContract) {
        contractNames.push(Contracts.DISTRIBUTION);
      }

      for (let name of contractNames) {
        // Act
        const address = await addressUpdater.getContractAddress(name);
        // Assert
        assert.equal(address, contracts.getContractAddress(name));
      }
    });
  });
});
