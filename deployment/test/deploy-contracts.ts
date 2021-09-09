import { constants, time } from '@openzeppelin/test-helpers';
import { pascalCase } from 'pascal-case';
import { waitFinalize3 } from "../../test/utils/test-helpers";
import {
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

const parameters = require(`../chain-config/${process.env.CHAIN_CONFIG}.json`)
const BN = web3.utils.toBN;

function capitalizeFirstLetter(st: string) {
  return st.charAt(0).toUpperCase() + st.slice(1).toLocaleLowerCase();
}

async function findAssetFtso(contracts: Contracts, address: string): Promise<boolean> {
  const Ftso = artifacts.require("Ftso");
  const ftsoWnat = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
  let xAssetFtso = await ftsoWnat.assetFtsos(0);
  let i = 1;
  while (xAssetFtso != "") {
    if (xAssetFtso == address) {
      return true;
    } else {
      try {
        xAssetFtso = await ftsoWnat.assetFtsos(i++);
      } catch (e) {
        xAssetFtso = "";
      }
    }
  }
  return false;
}

async function findFtso(contracts: Contracts, address: string): Promise<boolean> {
  const FtsoManager = artifacts.require("FtsoManager");
  const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
  let ftsos = await ftsoManager.getFtsos();
  let found = false;
  ftsos.forEach((ftso) => {
    if (ftso == address) found = true;
  });
  return found;
}

async function findRoleMember(role: string, permissioningAddress: any, memberAddress: any): Promise<boolean> {
  const roleMemberCount: BN = await permissioningAddress.getRoleMemberCount(role);
  for (let i = 0; i < roleMemberCount.toNumber(); i++) {
    if (await permissioningAddress.getRoleMember(role, i) == memberAddress.address) {
      return true;
    }
  }
  return false;
}

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`deploy-contracts.ts system tests`, async accounts => {
  let contracts: Contracts;

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
      FtsoRewardManager = artifacts.require("FtsoRewardManager");
      ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
      DataAvailabilityRewardManager = artifacts.require("DataAvailabilityRewardManager");
      dataAvailabilityRewardManager = await DataAvailabilityRewardManager.at(contracts.getContractAddress(Contracts.DATA_AVAILABILITY_REWARD_MANAGER));
    });

    it("Should have reward managers set", async () => {
      // Assemble
      // Act
      const sharingPctData = await inflationAllocation.getSharingPercentages();
      // console.log(sharingPctData);
      // Assert
      assert.equal(ftsoRewardManager.address, sharingPctData[0].inflationReceiver);
      assert.equal(BN(8000), sharingPctData[0].percentBips);
      assert.equal(dataAvailabilityRewardManager.address, sharingPctData[1].inflationReceiver);
      assert.equal(BN(2000), sharingPctData[1].percentBips);
    });

    it("Should fetch an ftso annual inflation percentage", async () => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.lastAnnualInflationPercentageBips();
      // Assert
      assert(percentage.gt(BN(0)));
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
      const rewardEpochStartTs = await ftsoManager.rewardEpochsStartTs();
      if (rewardEpochStartTs.lt(startTs) && await ftsoManager.active()) {
        // Act
        const startBlock = (await ftsoManager.rewardEpochs(0))[0];
        // Assert
        // If the daemon is calling daemonize on the RewardManager, then there should be
        // an active reward epoch.
        assert(startBlock.toNumber() != 0);
      }
    });

    it("Should know about PriceSubmitter", async () => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoManager.getPriceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
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
      const openingBalance = await wnat.balanceOf(accounts[1])
      // Act
      await waitFinalize3(accounts[1], () => wnat.deposit({ from: accounts[1], value: BN(10) }));
      // Assert
      const balance = await wnat.balanceOf(accounts[1])
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

  describe(Contracts.FTSO_WNAT, async () => {
    let FtsoWnat: FtsoContract;
    let ftsoWnat: FtsoInstance;

    beforeEach(async () => {
      FtsoWnat = artifacts.require("Ftso");
      ftsoWnat = await FtsoWnat.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
    });

    it("Should be on oracle for WNAT", async () => {
      // Assemble
      // Act
      const address = await ftsoWnat.wNat();
      // Assert
      assert.equal(address, contracts.getContractAddress(Contracts.WNAT));
    });

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

  for (let asset of [...parameters.assets]) {
    describe(pascalCase(`FTSO ${asset.assetSymbol}`), async () => {
      let FtsoAsset: FtsoContract;
      let ftsoAsset: FtsoInstance;

      beforeEach(async () => {
        FtsoAsset = artifacts.require("Ftso");
        ftsoAsset = await FtsoAsset.at(contracts.getContractAddress(`Ftso${capitalizeFirstLetter(asset.assetSymbol)}`));
      });

      it(`Should be on oracle for ${asset.assetSymbol}`, async () => {
        // Assemble
        // Act
        const address = await ftsoAsset.getAsset();
        // Assert
        if(parameters.deployDummyXAssetTokensAndMinters) {
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

    beforeEach(async () => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    for (let asset of parameters.assets) {
      it(`Should be managing an ${asset.assetSymbol} FTSO`, async () => {
        // Assemble
        // Act
        const found = await findFtso(contracts, contracts.getContractAddress(`Ftso${capitalizeFirstLetter(asset.assetSymbol)}`));
        // Assert
        assert(found);
      });
    }

    it("Should be managing a WNAT FTSO", async () => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_WNAT));
      // Assert
      assert(found);
    });

    it("Should have goveranance parameters set", async () => {
      // Assemble
      const settings = await ftsoManager.settings();
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
});
