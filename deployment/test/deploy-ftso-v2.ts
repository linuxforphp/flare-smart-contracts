import { constants } from '@openzeppelin/test-helpers';
import { pascalCase } from 'pascal-case';
import {
  AddressUpdaterContract,
  AddressUpdaterInstance,
  AssetTokenContract, AssetTokenInstance, FtsoContract,
  FtsoInstance, FtsoManagerContract,
  FtsoManagerInstance,
  FtsoV2SwitcherContract,
  FtsoV2SwitcherInstance
} from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";
import { capitalizeFirstLetter, findAssetFtso } from '../scripts/deploy-utils';


/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`deploy-ftso-v2.ts system tests`, async accounts => {
  let contracts: Contracts;
  let parameters: any;

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG);
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    before(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should have transfered governance to switcher contract", async () => {
      // Act
      const governance = await ftsoManager.governance();
      // Assert
      assert.equal(governance, contracts.getContractAddress(Contracts.FTSO_V2_SWITCHER));
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

  describe(Contracts.ADDRESS_UPDATER, async () => {
    let AddressUpdater: AddressUpdaterContract;
    let addressUpdater: AddressUpdaterInstance;

    before(async () => {
      AddressUpdater = artifacts.require("AddressUpdater");
      addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    });

    it("Should have transfered governance", async () => {
      // Act
      const governance = await addressUpdater.governance();
      // Assert
      assert.equal(governance, parameters.governancePublicKey);
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

  describe(Contracts.FTSO_V2_SWITCHER, async () => {
    let FtsoV2Switcher: FtsoV2SwitcherContract;
    let ftsoV2Switcher: FtsoV2SwitcherInstance;

    before(async () => {
      FtsoV2Switcher = artifacts.require("FtsoV2Switcher");
      ftsoV2Switcher = await FtsoV2Switcher.at(contracts.getContractAddress(Contracts.FTSO_V2_SWITCHER));
    });

    for (let asset of parameters.assets) {
      it(`Should know about the ${asset.assetSymbol} FTSO`, async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoV2Switcher, contracts.getContractAddress(`Ftso${capitalizeFirstLetter(asset.assetSymbol)}`));
        // Assert
        assert(found);
      });
    }

    if (parameters.deployNATFtso) {
      it("Should know about WNAT FTSO", async () => {
        // Assemble
        // Act
        const found = await findFtso(ftsoV2Switcher, contracts.getContractAddress(Contracts.FTSO_WNAT));
        // Assert
        assert(found);
      });
    }
    
    it("Should know about flare daemon registrants", async () => {
      // Assemble
      // Act
      const registrations = await ftsoV2Switcher.getFlareDaemonRegistrations();
      // Assert
      assert.equal(registrations[0].daemonizedContract, contracts.getContractAddress(Contracts.INFLATION));
      assert.equal(registrations[0].gasLimit, parameters.inflationGasLimit);
      assert.equal(registrations[1].daemonizedContract, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      assert.equal(registrations[2].gasLimit, parameters.ftsoManagerGasLimit);
    });
  });
});

async function findFtso(ftsoV2Switcher: FtsoV2SwitcherInstance, address: string): Promise<boolean> {
  let ftsos = await ftsoV2Switcher.getFtsosToReplace();
  let found = false;
  ftsos.forEach((ftso) => {
    if (ftso == address) found = true;
  });
  return found;
}
