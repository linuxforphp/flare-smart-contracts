import { constants } from '@openzeppelin/test-helpers';
import { pascalCase } from 'pascal-case';
import { waitFinalize3 } from "../../test/utils/test-helpers";
import {
  AddressUpdaterContract,
  AddressUpdaterInstance,
  AssetTokenContract, AssetTokenInstance, CleanupBlockNumberManagerContract, CleanupBlockNumberManagerInstance, DummyAssetMinterContract, FlareDaemonContract, FlareDaemonInstance, FtsoContract,
  FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance, FtsoRegistryContract, FtsoRegistryInstance, FtsoRewardManagerContract,
  FtsoRewardManagerInstance, GovernedBaseContract, PriceSubmitterContract, PriceSubmitterInstance, VoterWhitelisterContract, VoterWhitelisterInstance
} from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";
import { capitalizeFirstLetter, findAssetFtso, findFtso } from '../scripts/deploy-utils';


/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`switch-to-ftso-v2.ts system tests`, async accounts => {
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

  describe(Contracts.FLARE_DAEMON, async () => {
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    before(async () => {
      FlareDaemon = artifacts.require("FlareDaemon") as FlareDaemonContract;
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should be daemonizing inflation and new ftso manager", async () => {
      // Assemble
      // Act
      if (flareDaemon.address != parameters.flareDaemonAddress) {
        await flareDaemon.trigger();
      }
      const daemonizedContractsData = await flareDaemon.getDaemonizedContractsData();
      // Assert
      assert.equal(daemonizedContractsData[0][0], contracts.getContractAddress(Contracts.INFLATION));
      assert.equal(daemonizedContractsData[0][1], contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FLARE_DAEMON);
    });
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    before(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FTSO_MANAGER);
    });

    it("Should be activated", async () => {
      assert(await ftsoManager.active());
    });

    it("Should return old reward epoch data", async () => {
      // Assemble
     
      // Act
      const startBlock = (await ftsoManager.getRewardEpochData(0)).votepowerBlock;
      // Assert
      assert(startBlock.toNumber() != 0);
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

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;

    before(async () => {
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

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FTSO_REWARD_MANAGER);
    });
  });

  describe(Contracts.FTSO_REGISTRY, async () => {
    let FtsoRegistry: FtsoRegistryContract;
    let ftsoRegistry: FtsoRegistryInstance;

    before(async () => {
      FtsoRegistry = artifacts.require("FtsoRegistry");
      ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await ftsoRegistry.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FTSO_REGISTRY);
    });
  });

  describe(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, async () => {
    let CleanupBlockNumberManager: CleanupBlockNumberManagerContract;
    let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;

    before(async () => {
      CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
      cleanupBlockNumberManager = await CleanupBlockNumberManager.at(contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
    });

    it("Should be triggered by the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await cleanupBlockNumberManager.triggerContract();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER);
    });
  });

  describe(Contracts.VOTER_WHITELISTER, async () => {
    let VoterWhitelister: VoterWhitelisterContract;
    let voterWhitelister: VoterWhitelisterInstance;

    before(async () => {
      VoterWhitelister = artifacts.require("VoterWhitelister");
      voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await voterWhitelister.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.VOTER_WHITELISTER);
    });
  });

  describe(Contracts.PRICE_SUBMITTER, async () => {
    let PriceSubmitter: PriceSubmitterContract;
    let priceSubmitter: PriceSubmitterInstance;

    before(async () => {
      PriceSubmitter = artifacts.require("PriceSubmitter");
      priceSubmitter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });

    it("Should know about the FTSO manager", async () => {
      // Assemble
      // Act
      const ftsoManager = await priceSubmitter.getFtsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.PRICE_SUBMITTER);
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

      before(async () => {
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

      for (let asset of ["XRP", "LTC", "DOGE"]) {
        it(`Should know about ${asset} Asset FTSO`, async () => {
          // Assemble
          // Act
          const found = await findAssetFtso(contracts, contracts.getContractAddress(`Ftso${capitalizeFirstLetter(asset)}`));
          // Assert
          assert(found);
        });
      }

      it("Should know about XRP Asset FTSO", async () => {
        // Assemble
        // Act
        const found = await findAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_XRP));
        // Assert
        assert(found);
      });

      it("Should know about LTC Asset FTSO", async () => {
        // Assemble
        // Act
        const found = await findAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_LTC));
        // Assert
        assert(found);
      });

      it("Should know about XDG Asset FTSO", async () => {
        // Assemble
        // Act
        const found = await findAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_DOGE));
        // Assert
        assert(found);
      });
    });
  }

  for (let asset of [...parameters.assets]) {
    describe(pascalCase(`FTSO ${asset.assetSymbol}`), async () => {
      let FtsoAsset: FtsoContract;
      let ftsoAsset: FtsoInstance;

      before(async () => {
        FtsoAsset = artifacts.require("Ftso");
        ftsoAsset = await FtsoAsset.at(contracts.getContractAddress(`Ftso${capitalizeFirstLetter(asset.assetSymbol)}`));
      });

      it(`Should be on oracle for ${asset.assetSymbol}`, async () => {
        // Assemble
        // Act
        const address = await ftsoAsset.getAsset();
        // Assert
        if (parameters.deployDummyXAssetTokensAndMinters) {
          assert.equal(address, contracts.getContractAddress(`x${asset.assetSymbol}`));
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

        before(async () => {
          FAsset = artifacts.require("AssetToken");
          fAsset = await FAsset.at(contracts.getContractAddress(`${asset.xAssetSymbol}`));
        });

        it("Should be an asset representing XRP", async () => {
          // Assemble
          // Act
          const symbol = await fAsset.symbol();
          // Assert
          assert.equal(symbol, asset.xAssetSymbol);
        });

        it("Should represent XRP decimals correctly", async () => {
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

    before(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    for (let asset of parameters.assets) {
      it(`Should be managing an ${asset.assetSymbol} FTSO`, async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoManager, contracts.getContractAddress(`Ftso${capitalizeFirstLetter(asset.assetSymbol)}`));
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

    before(async () => {
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
