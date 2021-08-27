import {constants, time} from '@openzeppelin/test-helpers';

import { waitFinalize3 } from "../../test/utils/test-helpers";
import { FlareDaemon } from "../../typechain";
import { DummyAssetMinterContract, 
  AssetTokenContract,
  FtsoContract,
  FtsoInstance,
  FlareDaemonContract,
  FtsoRewardManagerContract,
  FtsoRewardManagerInstance,
  WNatContract, 
  InflationContract,
  InflationInstance,
  InflationAllocationContract,
  InflationAllocationInstance,
  SupplyContract,
  SupplyInstance,
  AssetTokenInstance,
  FtsoManagerContract,
  FtsoManagerInstance,
  FlareDaemonInstance,
  ValidatorRewardManagerContract,
  ValidatorRewardManagerInstance} from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";

// import { serializedParameters } from "../../../scripts/DeploymentParameters";

// console.log(process.argv)
// // const parameters = JSON.parse(serializedParameters);

const parameters = require(`../chain-config/${process.env.CHAIN_CONFIG}.json`)
const BN = web3.utils.toBN;

async function findDaemonizedContract(contracts: Contracts, address: string): Promise<boolean> {
  const FlareDaemon = artifacts.require("FlareDaemon");
  const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
  let daemonize = await flareDaemon.daemonizeContracts(0);
  let i = 1;
  while (daemonize != "") {
    if (daemonize == address) {
      return true;
    } else {
      try {
        daemonize = await flareDaemon.daemonizeContracts(i++);
      } catch(e) {
        daemonize = "";
      }
    }
  }
  return false;
}

async function findAssetFtso(contracts: Contracts, address: string): Promise<boolean> {
  const Ftso = artifacts.require("Ftso");
  const ftsoWnat = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
  let xAssetFtso = await ftsoWnat.xAssetFtsos(0);
  let i = 1;
  while (xAssetFtso != "") {
    if (xAssetFtso == address) {
      return true;
    } else {
      try {
        xAssetFtso = await ftsoWnat.xAssetFtsos(i++);
      } catch(e) {
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
contract(`deploy.ts system tests`, async accounts => {
  let contracts: Contracts;

  before(async() => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
  });

  describe (Contracts.SUPPLY, async() => {
    let Supply: SupplyContract;
    let supply: SupplyInstance;

    beforeEach(async() => {
      Supply = artifacts.require("Supply");
      supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
    });

    it("Should have an inflatable balance > 0", async() => {
      // Assemble
      // Act
      const inflatableBalance = await supply.getInflatableBalance();
      // Assert
      assert(inflatableBalance.gt(BN(0)));
    });
  });

  describe(Contracts.INFLATION_ALLOCATION, async() => {
    let InflationAllocation: InflationAllocationContract;
    let inflationAllocation: InflationAllocationInstance;
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;
    let ValidatorRewardManager: ValidatorRewardManagerContract;
    let validatorRewardManager: ValidatorRewardManagerInstance;

    beforeEach(async() => {
      InflationAllocation = artifacts.require("InflationAllocation");
      inflationAllocation = await InflationAllocation.at(contracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
      FtsoRewardManager = artifacts.require("FtsoRewardManager");
      ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
      ValidatorRewardManager = artifacts.require("ValidatorRewardManager");
      validatorRewardManager = await ValidatorRewardManager.at(contracts.getContractAddress(Contracts.VALIDATOR_REWARD_MANAGER));
    });

    it("Should have reward managers set", async() => {
      // Assemble
      // Act
      const sharingPctData = await inflationAllocation.getSharingPercentages();
      // console.log(sharingPctData);
      // Assert
      assert.equal(ftsoRewardManager.address, sharingPctData[0].inflationReceiver);
      assert.equal(BN(8000), sharingPctData[0].percentBips);
      assert.equal(validatorRewardManager.address, sharingPctData[1].inflationReceiver);
      assert.equal(BN(2000), sharingPctData[1].percentBips);
    });

    it("Should fetch an ftso annual inflation percentage", async() => {
      // Assemble
      // Act
      const percentage = await inflationAllocation.lastAnnualInflationPercentageBips();
      // Assert
      assert(percentage.gt(BN(0)));
    });
  });

  describe(Contracts.FLARE_DAEMON, async() => {
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    beforeEach(async() => {
      FlareDaemon = artifacts.require("FlareDaemon") as FlareDaemonContract;
      flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should be daemonizing", async() => {
      // Assemble
      // Act
      if (flareDaemon.address != parameters.flareDaemonAddress) {
        await flareDaemon.trigger();
      }
      const systemLastTriggeredAt = await flareDaemon.systemLastTriggeredAt();
      // Assert
      assert(systemLastTriggeredAt.toNumber() > 0);
    });

    it("Should be daemonizing inflation contract", async() => {
      // Assemble
      // Act
      const found = await findDaemonizedContract(contracts, contracts.getContractAddress(Contracts.INFLATION));
      // Assert
      assert(found);
    });

    it("Should be daemonizing ftso manager", async() => {
      // Assemble
      // Act
      const found = await findDaemonizedContract(contracts, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      // Assert
      assert(found);
    });

    it("Should have block holdoff set", async() => {
      // Assemble
      // Act
      const blockHoldoff = await flareDaemon.blockHoldoff();
      // Assert
      assert.equal(blockHoldoff.toString(), parameters.flareDaemonGasExceededHoldoffBlocks.toString());
    })
  });

  describe(Contracts.FTSO_MANAGER, async() => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    beforeEach(async() => {
        FtsoManager = artifacts.require("FtsoManager");
        ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should have a reward epoch if rewarding started and being daemonized by daemon", async() => {
       // Assemble
       const startTs = await time.latest();
       const rewardEpochStartTs = await ftsoManager.rewardEpochsStartTs();
       if (rewardEpochStartTs.lt(startTs)) {
        // Act
        const startBlock = (await ftsoManager.rewardEpochs(0))[0];
        // Assert
        // If the daemon is calling daemonize on the RewardManager, then there should be
        // an active reward epoch.
        assert(startBlock.toNumber() != 0);
       }
    });

    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoManager.getPriceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });

  describe(Contracts.INFLATION, async() => {
    let Inflation: InflationContract;
    let inflation: InflationInstance;
    let Supply: SupplyContract;
    let supply: SupplyInstance;
    let FlareDaemon: FlareDaemonContract;
    let flareDaemon: FlareDaemonInstance;

    beforeEach(async() => {
        Inflation = artifacts.require("Inflation");
        inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
        Supply = artifacts.require("Supply");
        supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
        FlareDaemon = artifacts.require("FlareDaemon");
        flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    });

    it("Should have recognized inflation set if rewarding started", async() => {
        // Assemble
        const rewardEpochStartTs = await inflation.rewardEpochStartTs();
        const startTs = await time.latest();
        // Act
        await flareDaemon.trigger();
        // Assert
        if (rewardEpochStartTs.lt(startTs)) {
          const { 0: recognizedInflationWei } = await inflation.getCurrentAnnum() as any;
          assert(BN(recognizedInflationWei).gt(BN(0)));  
        }
    });

    it("Should know about supply contract", async() => {
      // Assemble
      // Act
      const address = await inflation.supply();
      // Assert
      assert.equal(address, supply.address);
    });

    it("Should know about flare daemon contract", async() => {
      // Assemble
      // Act
      const address = await inflation.flareDaemon();
      // Assert
      assert.equal(address, flareDaemon.address);
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async() => {
    let FtsoRewardManager: FtsoRewardManagerContract;
    let ftsoRewardManager: FtsoRewardManagerInstance;

    beforeEach(async() => {
      FtsoRewardManager = artifacts.require("FtsoRewardManager");
      ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    });

    it("Should know about the FTSO manager", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoRewardManager.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
  });

  describe(Contracts.WNAT, async() => {
    it("Should accept deposits", async() => {
        // Assemble
        const WNAT = artifacts.require("WNat") as WNatContract;
        const wnat = await WNAT.at(contracts.getContractAddress(Contracts.WNAT));
        const openingBalance = await wnat.balanceOf(accounts[1])
        // Act
        await waitFinalize3(accounts[1], () =>  wnat.deposit({from: accounts[1], value: BN(10)}));
        // Assert
        const balance = await wnat.balanceOf(accounts[1])
        assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FXRP_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFxrpMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
        const dummyFxrpMinter = await DummyFxrpMinter.at(contracts.getContractAddress(Contracts.DUMMY_FXRP_MINTER));
        const FXRP = artifacts.require("AssetToken") as AssetTokenContract;
        const fxrp = await FXRP.at(contracts.getContractAddress(Contracts.FXRP));
        const openingBalance = await fxrp.balanceOf(accounts[1])
        // Act
        await waitFinalize3(accounts[0], () => dummyFxrpMinter.mintRequest(10, accounts[1], constants.ZERO_ADDRESS));
        // Assert
        const balance = await fxrp.balanceOf(accounts[1])
        assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FLTC_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFltcMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
        const dummyFltcMinter = await DummyFltcMinter.at(contracts.getContractAddress(Contracts.DUMMY_FLTC_MINTER));
        const FLTC = artifacts.require("AssetToken") as AssetTokenContract;
        const fltc = await FLTC.at(contracts.getContractAddress(Contracts.FLTC));
        const openingBalance = await fltc.balanceOf(accounts[2])
        // Act
        await waitFinalize3(accounts[0], () =>  dummyFltcMinter.mintRequest(10, accounts[2], constants.ZERO_ADDRESS));
        // Assert
        const balance = await fltc.balanceOf(accounts[2])
        assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FXDG_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFxdgMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
        const dummyFxdgMinter = await DummyFxdgMinter.at(contracts.getContractAddress(Contracts.DUMMY_FXDG_MINTER));
        const FXDG = artifacts.require("AssetToken") as AssetTokenContract;
        const fxdg = await FXDG.at(contracts.getContractAddress(Contracts.FXDG));
        const openingBbalance = await fxdg.balanceOf(accounts[3])
        // Act
        await waitFinalize3(accounts[0], () =>  dummyFxdgMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS));
        // Assert
        const balance = await fxdg.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FADA_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFadaMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
        const dummyFadaMinter = await DummyFadaMinter.at(contracts.getContractAddress(Contracts.DUMMY_FADA_MINTER));
        const FADA = artifacts.require("AssetToken") as AssetTokenContract;
        const fada = await FADA.at(contracts.getContractAddress(Contracts.FADA));
        const openingBbalance = await fada.balanceOf(accounts[3])
        // Act
        await waitFinalize3(accounts[0], () =>  dummyFadaMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS));
        // Assert
        const balance = await fada.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FALGO_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFalgoMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
        const dummyFalgoMinter = await DummyFalgoMinter.at(contracts.getContractAddress(Contracts.DUMMY_FALGO_MINTER));
        const FALGO = artifacts.require("AssetToken") as AssetTokenContract;
        const falgo = await FALGO.at(contracts.getContractAddress(Contracts.FALGO));
        const openingBbalance = await falgo.balanceOf(accounts[3])
        // Act
        await waitFinalize3(accounts[0], () =>  dummyFalgoMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS));
        // Assert
        const balance = await falgo.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FBCH_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFbchMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
        const dummyFbchMinter = await DummyFbchMinter.at(contracts.getContractAddress(Contracts.DUMMY_FBCH_MINTER));
        const FBCH = artifacts.require("AssetToken") as AssetTokenContract;
        const fbch = await FBCH.at(contracts.getContractAddress(Contracts.FBCH));
        const openingBbalance = await fbch.balanceOf(accounts[3])
        // Act
        await waitFinalize3(accounts[0], () =>  dummyFbchMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS));
        // Assert
        const balance = await fbch.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FDGB_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFdgbMinter = artifacts.require("DummyAssetMinter") as DummyAssetMinterContract;
        const dummyFdgbMinter = await DummyFdgbMinter.at(contracts.getContractAddress(Contracts.DUMMY_FDGB_MINTER));
        const FDGB = artifacts.require("AssetToken") as AssetTokenContract;
        const fdgb = await FDGB.at(contracts.getContractAddress(Contracts.FDGB));
        const openingBbalance = await fdgb.balanceOf(accounts[3])
        // Act
        await waitFinalize3(accounts[0], () =>  dummyFdgbMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS));
        // Assert
        const balance = await fdgb.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.FTSO_WNAT, async() => {
    let FtsoWnat: FtsoContract;
    let ftsoWnat: FtsoInstance;

    beforeEach(async() => {
      FtsoWnat = artifacts.require("Ftso");
      ftsoWnat = await FtsoWnat.at(contracts.getContractAddress(Contracts.FTSO_WNAT));
    });

    it("Should be on oracle for WNAT", async() => {
        // Assemble
        // Act
        const address = await ftsoWnat.wNat();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.WNAT));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoWnat.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoWnat.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });

    it("Should know about XRP Asset FTSO", async() => {
      // Assemble
      // Act
      const found = await findAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXRP));
      // Assert
      assert(found);
    });    

    it("Should know about LTC Asset FTSO", async() => {
      // Assemble
      // Act
      const found = await findAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FLTC));
      // Assert
      assert(found);
    });    

    it("Should know about XDG Asset FTSO", async() => {
      // Assemble
      // Act
      const found = await findAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXDG));
      // Assert
      assert(found);
    });    
  });

  describe(Contracts.FTSO_FXRP, async() => {
    let FtsoFxrp: FtsoContract;
    let ftsoFxrp: FtsoInstance;

    beforeEach(async() => {
      FtsoFxrp = artifacts.require("Ftso");
      ftsoFxrp = await FtsoFxrp.at(contracts.getContractAddress(Contracts.FTSO_FXRP));
    });

    it("Should be on oracle for FXRP", async() => {
        // Assemble
        // Act
        const address = await ftsoFxrp.getAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FXRP));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFxrp.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoFxrp.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });
   
  describe(Contracts.FTSO_FLTC, async() => {
    let FtsoFltc: FtsoContract;
    let ftsoFltc: FtsoInstance;

    beforeEach(async() => {
      FtsoFltc = artifacts.require("Ftso");
      ftsoFltc = await FtsoFltc.at(contracts.getContractAddress(Contracts.FTSO_FLTC));
    });

    it("Should be on oracle for FLTC", async() => {
        // Assemble
        // Act
        const address = await ftsoFltc.getAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FLTC));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFltc.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
    
    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoFltc.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });

  describe(Contracts.FTSO_FXDG, async() => {
    let FtsoFxdg: FtsoContract;
    let ftsoFxdg: FtsoInstance;

    beforeEach(async() => {
      FtsoFxdg = artifacts.require("Ftso");
      ftsoFxdg = await FtsoFxdg.at(contracts.getContractAddress(Contracts.FTSO_FXDG));
    });
    
    it("Should be on oracle for FXDG", async() => {
        // Assemble
        // Act
        const address = await ftsoFxdg.getAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FXDG));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFxdg.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
    
    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoFxdg.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });

  describe(Contracts.FTSO_FADA, async() => {
    let FtsoFada: FtsoContract;
    let ftsoFada: FtsoInstance;

    beforeEach(async() => {
      FtsoFada = artifacts.require("Ftso");
      ftsoFada = await FtsoFada.at(contracts.getContractAddress(Contracts.FTSO_FADA));
    });
    
    it("Should be on oracle for FADA", async() => {
        // Assemble
        // Act
        const address = await ftsoFada.getAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FADA));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFada.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
    
    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoFada.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });

  describe(Contracts.FTSO_FALGO, async() => {
    let FtsoFalgo: FtsoContract;
    let ftsoFalgo: FtsoInstance;

    beforeEach(async() => {
      FtsoFalgo = artifacts.require("Ftso");
      ftsoFalgo = await FtsoFalgo.at(contracts.getContractAddress(Contracts.FTSO_FALGO));
    });
    
    it("Should be on oracle for FALGO", async() => {
        // Assemble
        // Act
        const address = await ftsoFalgo.getAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FALGO));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFalgo.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
    
    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoFalgo.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });

  describe(Contracts.FTSO_FBCH, async() => {
    let FtsoFbch: FtsoContract;
    let ftsoFbch: FtsoInstance;

    beforeEach(async() => {
      FtsoFbch = artifacts.require("Ftso");
      ftsoFbch = await FtsoFbch.at(contracts.getContractAddress(Contracts.FTSO_FBCH));
    });
    
    it("Should be on oracle for FBCH", async() => {
        // Assemble
        // Act
        const address = await ftsoFbch.getAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FBCH));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFbch.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
    
    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoFbch.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });

  describe(Contracts.FTSO_FDGB, async() => {
    let FtsoFdgb: FtsoContract;
    let ftsoFdgb: FtsoInstance;

    beforeEach(async() => {
      FtsoFdgb = artifacts.require("Ftso");
      ftsoFdgb = await FtsoFdgb.at(contracts.getContractAddress(Contracts.FTSO_FDGB));
    });
    
    it("Should be on oracle for FDGB", async() => {
        // Assemble
        // Act
        const address = await ftsoFdgb.getAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FDGB));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFdgb.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
    
    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoFdgb.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });


  describe(Contracts.FXRP, async() => {
    let FXRP: AssetTokenContract;
    let fxrp: AssetTokenInstance;

    beforeEach(async() => {
      FXRP = artifacts.require("AssetToken");
      fxrp = await FXRP.at(contracts.getContractAddress(Contracts.FXRP));
    });

    it("Should be an asset representing XRP", async() => {
        // Assemble
        // Act
        const symbol = await fxrp.symbol();
        // Assert
        assert.equal(symbol, parameters.XRP.xAssetSymbol);
    });

    it("Should represent XRP decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fxrp.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.XRP.xAssetDecimals);
    });
  });

  describe(Contracts.FLTC, async() => {
    let FLTC: AssetTokenContract;
    let fltc: AssetTokenInstance;

    beforeEach(async() => {
      FLTC = artifacts.require("AssetToken");
      fltc = await FLTC.at(contracts.getContractAddress(Contracts.FLTC));
    });

    it("Should be an asset representing LTC", async() => {
        // Assemble
        // Act
        const symbol = await fltc.symbol();
        // Assert
        assert.equal(symbol, parameters.LTC.xAssetSymbol);
    });

    it("Should represent LTC decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fltc.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.LTC.xAssetDecimals);
    });    
  });

  describe(Contracts.FXDG, async() => {
    let FXDG: AssetTokenContract;
    let fxdg: AssetTokenInstance;

    beforeEach(async() => {
      FXDG = artifacts.require("AssetToken");
      fxdg = await FXDG.at(contracts.getContractAddress(Contracts.FXDG));
    });

    it("Should be an asset representing XDG", async() => {
        // Assemble
        // Act
        const symbol = await fxdg.symbol();
        // Assert
        assert.equal(symbol, parameters.XDG.xAssetSymbol);
    });

    it("Should represent XDG decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fxdg.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.XDG.xAssetDecimals);
    });        
  });

  describe(Contracts.FADA, async() => {
    let FADA: AssetTokenContract;
    let fada: AssetTokenInstance;

    beforeEach(async() => {
      FADA = artifacts.require("AssetToken");
      fada = await FADA.at(contracts.getContractAddress(Contracts.FADA));
    });

    it("Should be an asset representing ADA", async() => {
        // Assemble
        // Act
        const symbol = await fada.symbol();
        // Assert
        assert.equal(symbol, parameters.ADA.xAssetSymbol);
    });

    it("Should represent ADA decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fada.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.ADA.xAssetDecimals);
    });        
  });

  describe(Contracts.FALGO, async() => {
    let FALGO: AssetTokenContract;
    let falgo: AssetTokenInstance;

    beforeEach(async() => {
      FALGO = artifacts.require("AssetToken");
      falgo = await FALGO.at(contracts.getContractAddress(Contracts.FALGO));
    });

    it("Should be an asset representing ALGO", async() => {
        // Assemble
        // Act
        const symbol = await falgo.symbol();
        // Assert
        assert.equal(symbol, parameters.ALGO.xAssetSymbol);
    });

    it("Should represent ALGO decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await falgo.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.ALGO.xAssetDecimals);
    });        
  });

  describe(Contracts.FBCH, async() => {
    let FBCH: AssetTokenContract;
    let fbch: AssetTokenInstance;

    beforeEach(async() => {
      FBCH = artifacts.require("AssetToken");
      fbch = await FBCH.at(contracts.getContractAddress(Contracts.FBCH));
    });

    it("Should be an asset representing BCH", async() => {
        // Assemble
        // Act
        const symbol = await fbch.symbol();
        // Assert
        assert.equal(symbol, parameters.BCH.xAssetSymbol);
    });

    it("Should represent BCH decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fbch.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.BCH.xAssetDecimals);
    });        
  });

  describe(Contracts.FDGB, async() => {
    let FDGB: AssetTokenContract;
    let fdgb: AssetTokenInstance;

    beforeEach(async() => {
      FDGB = artifacts.require("AssetToken");
      fdgb = await FDGB.at(contracts.getContractAddress(Contracts.FDGB));
    });

    it("Should be an asset representing DGB", async() => {
        // Assemble
        // Act
        const symbol = await fdgb.symbol();
        // Assert
        assert.equal(symbol, parameters.DGB.xAssetSymbol);
    });

    it("Should represent DGB decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fdgb.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.DGB.xAssetDecimals);
    });        
  });


  describe(Contracts.FTSO_MANAGER, async() => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    beforeEach(async() => {
      FtsoManager = artifacts.require("FtsoManager");
      ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should be managing an XRP FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXRP));
      // Assert
      assert(found);
    });

    it("Should be managing an LTC FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FLTC));
      // Assert
      assert(found);
    });            

    it("Should be managing an XDG FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXDG));
      // Assert
      assert(found);
    });

    it("Should be managing an ADA FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FADA));
      // Assert
      assert(found);
    });

    it("Should be managing an ALGO FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FALGO));
      // Assert
      assert(found);
    });

    it("Should be managing an BCH FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FBCH));
      // Assert
      assert(found);
    });

    it("Should be managing an DGB FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FDGB));
      // Assert
      assert(found);
    });


    it("Should be managing a WNAT FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_WNAT));
      // Assert
      assert(found);
    });

    it("Should have goverannace parameters set", async() => {
      // Assemble
      const settings = await ftsoManager.settings();
      // Act
      const maxVotePowerNatThresholdFraction = settings[1];
      const maxVotePowerAssetThresholdFraction = settings[2];
      const lowAssetThresholdUSDDec5 = settings[3];
      const highAssetThresholdUSDDec5 = settings[4];
      const highAssetTurnoutThresholdBIPS = settings[5];
      const lowNatTurnoutThresholdBIPS = settings[6];
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
