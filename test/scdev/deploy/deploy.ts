const {constants, time} = require('@openzeppelin/test-helpers');

import { ReadStream } from "node:fs";
import { DummyFAssetMinterContract, 
  FAssetTokenContract,
  FtsoContract,
  FtsoInstance,
  FlareKeeperContract,
  RewardManagerContract,
  RewardManagerInstance,
  WFLRContract, 
  InflationContract,
  InflationInstance,
  FAssetTokenInstance,
  FtsoManagerContract,
  FtsoManagerInstance } from "../../../typechain-truffle";

// import { serializedParameters } from "../../../scripts/DeploymentParameters";

// console.log(process.argv)
// // const parameters = JSON.parse(serializedParameters);

const parameters = require(`../../../scripts/chain-config/${process.env.CHAIN_CONFIG}.json`)
const BN = web3.utils.toBN;

class Contracts {
  private contracts: Map<string, string>;
  public static readonly INFLATION = "Inflation";
  public static readonly REWARD_MANAGER = "RewardManager";
  public static readonly PRICE_SUBMITTER = "PriceSubmitter";
  public static readonly FTSO_MANAGER = "FtsoManager";
  public static readonly FLARE_KEEPER = "FlareKeeper";
  public static readonly WFLR = "Wflr";
  public static readonly FXRP = "Fxrp";
  public static readonly DUMMY_FXRP_MINTER = "DummyFxrpMinter";
  public static readonly FTSO_FXRP = "FtsoFxrp";
  public static readonly FLTC = "Fltc";
  public static readonly DUMMY_FLTC_MINTER = "DummyFltcMinter";
  public static readonly FTSO_FLTC = "FtsoFltc";
  public static readonly FXDG = "Fxdg";
  public static readonly DUMMY_FXDG_MINTER = "DummyFxdgMinter";
  public static readonly FTSO_FXDG = "FtsoFxdg";
  public static readonly FTSO_WFLR = "FtsoWflr";

  public static readonly FADA = "Fada";
  public static readonly DUMMY_FADA_MINTER = "DummyFadaMinter";
  public static readonly FTSO_FADA = "FtsoFada";
  public static readonly FALGO = "Falgo";
  public static readonly DUMMY_FALGO_MINTER = "DummyFalgoMinter";
  public static readonly FTSO_FALGO = "FtsoFalgo";
  public static readonly FBCH = "Fbch";
  public static readonly DUMMY_FBCH_MINTER = "DummyFbchMinter";
  public static readonly FTSO_FBCH = "FtsoFbch";
  public static readonly FDGB = "Fdgb";
  public static readonly DUMMY_FDGB_MINTER = "DummyFdgbMinter";
  public static readonly FTSO_FDGB = "FtsoFdgb";


  constructor() {
    this.contracts = new Map<string, string>();
  }

  async deserialize(stream: any) {
    const contractsJson = await this.read(stream);
    const parsedContracts = JSON.parse(contractsJson);
    parsedContracts.forEach((contract: { name: string; address: string; }) => {
      this.contracts.set(contract.name, contract.address);
    })
  }

  getContractAddress(name: string): string {
    if (this.contracts.has(name)) {
      return this.contracts.get(name) as string;
    } else {
      throw new Error(`${name} not found`);
    }
  }

  async read(stream: ReadStream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk); 
    return Buffer.concat(chunks).toString('utf-8');
  }    
}

async function findKeptContract(contracts: Contracts, address: string): Promise<boolean> {
  const FlareKeeper = artifacts.require("FlareKeeper");
  const flareKeeper = await FlareKeeper.at(contracts.getContractAddress(Contracts.FLARE_KEEPER));
  let keeping = await flareKeeper.keepContracts(0);
  let i = 1;
  while (keeping != "") {
    if (keeping == address) {
      return true;
    } else {
      try {
        keeping = await flareKeeper.keepContracts(i++);
      } catch(e) {
        keeping = "";
      }
    }
  }
  return false;
}

async function findFAssetFtso(contracts: Contracts, address: string): Promise<boolean> {
  const Ftso = artifacts.require("Ftso");
  const ftsoWflr = await Ftso.at(contracts.getContractAddress(Contracts.FTSO_WFLR));
  let fAssetFtso = await ftsoWflr.fAssetFtsos(0);
  let i = 1;
  while (fAssetFtso != "") {
    if (fAssetFtso == address) {
      return true;
    } else {
      try {
        fAssetFtso = await ftsoWflr.fAssetFtsos(i++);
      } catch(e) {
        fAssetFtso = "";
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

  describe(Contracts.FLARE_KEEPER, async() => {
    it("Should be keeping", async() => {
      // Assemble
      const FlareKeeper = artifacts.require("FlareKeeper") as FlareKeeperContract;
      const flareKeeper = await FlareKeeper.at(contracts.getContractAddress(Contracts.FLARE_KEEPER));
        // Act
      const systemLastTriggeredAt = await flareKeeper.systemLastTriggeredAt();
      // Assert
      assert(systemLastTriggeredAt.toNumber() > 0);
    });

    it("Should be keeping inflation contract", async() => {
      // Assemble
      // Act
      const found = await findKeptContract(contracts, contracts.getContractAddress(Contracts.INFLATION));
      // Assert
      assert(found);
    });

    it("Should be keeping ftso manager", async() => {
      // Assemble
      // Act
      const found = await findKeptContract(contracts, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      // Assert
      assert(found);
    });
  });

  describe(Contracts.FTSO_MANAGER, async() => {
    let FtsoManager: FtsoManagerContract;
    let ftsoManager: FtsoManagerInstance;

    beforeEach(async() => {
        FtsoManager = artifacts.require("FtsoManager");
        ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should by kept by keeper", async() => {
        // Assemble
        // Act
        const startBlock = (await ftsoManager.rewardEpochs(0))[0];
        // Assert
        // If the keeper is calling keep on the RewardManager, then there should be
        // an active reward epoch.
        assert(startBlock.toNumber() != 0);
    });

    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoManager.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });
  });

  describe(Contracts.INFLATION, async() => {
    let Inflation: InflationContract;
    let inflation: InflationInstance;

    beforeEach(async() => {
        Inflation = artifacts.require("Inflation");
        inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
    });

    it("Should know the reward manager", async() => {
        // Assemble
        // Act
        const rewardManager = await inflation.rewardManager();
        // Assert
        // If the keeper is calling keep on the RewardManager, then there should be
        // an active reward epoch.
        assert.equal(rewardManager, contracts.getContractAddress(Contracts.REWARD_MANAGER));
    });

    it("Should end current annum in the future", async() => {
        // Assemble
        const currentTs = await time.latest();
        // Act
        const endAnnumTs = await inflation.currentAnnumEndsTs();
        // Assert
        assert(endAnnumTs > currentTs, "Current timestamp after end of annum timestamp");
    });

    it("Should have the total supply set", async() => {
        // Assemble
        const currentFlareAnnum = await inflation.currentFlareAnnum();
        // Act
        const totalSupply = (await inflation.flareAnnumData(currentFlareAnnum))[0];
        // Assert
        assert(totalSupply.eq(web3.utils.toWei(BN(parameters.totalFlrSupply))));
    });
  });

  describe(Contracts.REWARD_MANAGER, async() => {
    let RewardManager: RewardManagerContract;
    let rewardManager: RewardManagerInstance;

    beforeEach(async() => {
      RewardManager = artifacts.require("RewardManager");
      rewardManager = await RewardManager.at(contracts.getContractAddress(Contracts.REWARD_MANAGER));
    });

    it("Should know about inflation contract", async() => {
      // Assemble
      // Act
      const inflation = await rewardManager.inflationContract();
      // Assert
      assert.equal(inflation, contracts.getContractAddress(Contracts.INFLATION));
    });

    it("Should know about the FTSO manager contract", async() => {
      // Assemble
      // Act
      const ftsoManager = await rewardManager.ftsoManagerContract();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should have a daily reward amount set", async() => {
      // Assemble
      // Act
      const dailyReward = await rewardManager.dailyRewardAmountTwei();
      // Assert
      assert(dailyReward.gt(BN(0)));
    });
  });

  describe(Contracts.WFLR, async() => {
    it("Should accept deposits", async() => {
        // Assemble
        const WFLR = artifacts.require("WFLR") as WFLRContract;
        const wflr = await WFLR.at(contracts.getContractAddress(Contracts.WFLR));
        const openingBalance = await wflr.balanceOf(accounts[1])
        // Act
        await wflr.deposit({from: accounts[1], value: BN(10)})
        // Assert
        const balance = await wflr.balanceOf(accounts[1])
        assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FXRP_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFxrpMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFxrpMinter = await DummyFxrpMinter.at(contracts.getContractAddress(Contracts.DUMMY_FXRP_MINTER));
        const FXRP = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fxrp = await FXRP.at(contracts.getContractAddress(Contracts.FXRP));
        const openingBalance = await fxrp.balanceOf(accounts[1])
        // Act
        await dummyFxrpMinter.mintRequest(10, accounts[1], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fxrp.balanceOf(accounts[1])
        assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FLTC_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFltcMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFltcMinter = await DummyFltcMinter.at(contracts.getContractAddress(Contracts.DUMMY_FLTC_MINTER));
        const FLTC = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fltc = await FLTC.at(contracts.getContractAddress(Contracts.FLTC));
        const openingBalance = await fltc.balanceOf(accounts[2])
        // Act
        await dummyFltcMinter.mintRequest(10, accounts[2], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fltc.balanceOf(accounts[2])
        assert.equal(balance.toNumber() - openingBalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FXDG_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFxdgMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFxdgMinter = await DummyFxdgMinter.at(contracts.getContractAddress(Contracts.DUMMY_FXDG_MINTER));
        const FXDG = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fxdg = await FXDG.at(contracts.getContractAddress(Contracts.FXDG));
        const openingBbalance = await fxdg.balanceOf(accounts[3])
        // Act
        await dummyFxdgMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fxdg.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FADA_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFadaMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFadaMinter = await DummyFadaMinter.at(contracts.getContractAddress(Contracts.DUMMY_FADA_MINTER));
        const FADA = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fada = await FADA.at(contracts.getContractAddress(Contracts.FADA));
        const openingBbalance = await fada.balanceOf(accounts[3])
        // Act
        await dummyFadaMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fada.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FALGO_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFalgoMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFalgoMinter = await DummyFalgoMinter.at(contracts.getContractAddress(Contracts.DUMMY_FALGO_MINTER));
        const FALGO = artifacts.require("FAssetToken") as FAssetTokenContract;
        const falgo = await FALGO.at(contracts.getContractAddress(Contracts.FALGO));
        const openingBbalance = await falgo.balanceOf(accounts[3])
        // Act
        await dummyFalgoMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS);
        // Assert
        const balance = await falgo.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FBCH_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFbchMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFbchMinter = await DummyFbchMinter.at(contracts.getContractAddress(Contracts.DUMMY_FBCH_MINTER));
        const FBCH = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fbch = await FBCH.at(contracts.getContractAddress(Contracts.FBCH));
        const openingBbalance = await fbch.balanceOf(accounts[3])
        // Act
        await dummyFbchMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fbch.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FDGB_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFdgbMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFdgbMinter = await DummyFdgbMinter.at(contracts.getContractAddress(Contracts.DUMMY_FDGB_MINTER));
        const FDGB = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fdgb = await FDGB.at(contracts.getContractAddress(Contracts.FDGB));
        const openingBbalance = await fdgb.balanceOf(accounts[3])
        // Act
        await dummyFdgbMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fdgb.balanceOf(accounts[3])
        assert.equal(balance.toNumber() - openingBbalance.toNumber(), 10);
    });
  });

  describe(Contracts.FTSO_WFLR, async() => {
    let FtsoWflr: FtsoContract;
    let ftsoWflr: FtsoInstance;

    beforeEach(async() => {
      FtsoWflr = artifacts.require("Ftso");
      ftsoWflr = await FtsoWflr.at(contracts.getContractAddress(Contracts.FTSO_WFLR));
    });

    it("Should be on oracle for WFLR", async() => {
        // Assemble
        // Act
        const address = await ftsoWflr.fFlr();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.WFLR));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoWflr.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });

    it("Should know about PriceSubmitter", async() => {
      // Assemble
      // Act
      const priceSubmitter = await ftsoWflr.priceSubmitter();
      // Assert
      assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    });

    it("Should know about XRP FAsset FTSO", async() => {
      // Assemble
      // Act
      const found = await findFAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXRP));
      // Assert
      assert(found);
    });    

    it("Should know about LTC FAsset FTSO", async() => {
      // Assemble
      // Act
      const found = await findFAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FLTC));
      // Assert
      assert(found);
    });    

    it("Should know about XDG FAsset FTSO", async() => {
      // Assemble
      // Act
      const found = await findFAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXDG));
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
        const address = await ftsoFxrp.getFAsset();
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
        const address = await ftsoFltc.getFAsset();
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
        const address = await ftsoFxdg.getFAsset();
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
        const address = await ftsoFada.getFAsset();
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
        const address = await ftsoFalgo.getFAsset();
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
        const address = await ftsoFbch.getFAsset();
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
        const address = await ftsoFdgb.getFAsset();
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
    let FXRP: FAssetTokenContract;
    let fxrp: FAssetTokenInstance;

    beforeEach(async() => {
      FXRP = artifacts.require("FAssetToken");
      fxrp = await FXRP.at(contracts.getContractAddress(Contracts.FXRP));
    });

    it("Should be a Flare asset representing XRP", async() => {
        // Assemble
        // Act
        const symbol = await fxrp.symbol();
        // Assert
        assert.equal(symbol, parameters.XRP.fAssetSymbol);
    });

    it("Should represent XRP decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fxrp.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.XRP.fAssetDecimals);
    });
  });

  describe(Contracts.FLTC, async() => {
    let FLTC: FAssetTokenContract;
    let fltc: FAssetTokenInstance;

    beforeEach(async() => {
      FLTC = artifacts.require("FAssetToken");
      fltc = await FLTC.at(contracts.getContractAddress(Contracts.FLTC));
    });

    it("Should be a Flare asset representing LTC", async() => {
        // Assemble
        // Act
        const symbol = await fltc.symbol();
        // Assert
        assert.equal(symbol, parameters.LTC.fAssetSymbol);
    });

    it("Should represent LTC decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fltc.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.LTC.fAssetDecimals);
    });    
  });

  describe(Contracts.FXDG, async() => {
    let FXDG: FAssetTokenContract;
    let fxdg: FAssetTokenInstance;

    beforeEach(async() => {
      FXDG = artifacts.require("FAssetToken");
      fxdg = await FXDG.at(contracts.getContractAddress(Contracts.FXDG));
    });

    it("Should be a Flare asset representing XDG", async() => {
        // Assemble
        // Act
        const symbol = await fxdg.symbol();
        // Assert
        assert.equal(symbol, parameters.XDG.fAssetSymbol);
    });

    it("Should represent XDG decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fxdg.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.XDG.fAssetDecimals);
    });        
  });

  describe(Contracts.FADA, async() => {
    let FADA: FAssetTokenContract;
    let fada: FAssetTokenInstance;

    beforeEach(async() => {
      FADA = artifacts.require("FAssetToken");
      fada = await FADA.at(contracts.getContractAddress(Contracts.FADA));
    });

    it("Should be a Flare asset representing ADA", async() => {
        // Assemble
        // Act
        const symbol = await fada.symbol();
        // Assert
        assert.equal(symbol, parameters.ADA.fAssetSymbol);
    });

    it("Should represent ADA decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fada.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.ADA.fAssetDecimals);
    });        
  });

  describe(Contracts.FALGO, async() => {
    let FALGO: FAssetTokenContract;
    let falgo: FAssetTokenInstance;

    beforeEach(async() => {
      FALGO = artifacts.require("FAssetToken");
      falgo = await FALGO.at(contracts.getContractAddress(Contracts.FALGO));
    });

    it("Should be a Flare asset representing ALGO", async() => {
        // Assemble
        // Act
        const symbol = await falgo.symbol();
        // Assert
        assert.equal(symbol, parameters.ALGO.fAssetSymbol);
    });

    it("Should represent ALGO decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await falgo.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.ALGO.fAssetDecimals);
    });        
  });

  describe(Contracts.FBCH, async() => {
    let FBCH: FAssetTokenContract;
    let fbch: FAssetTokenInstance;

    beforeEach(async() => {
      FBCH = artifacts.require("FAssetToken");
      fbch = await FBCH.at(contracts.getContractAddress(Contracts.FBCH));
    });

    it("Should be a Flare asset representing BCH", async() => {
        // Assemble
        // Act
        const symbol = await fbch.symbol();
        // Assert
        assert.equal(symbol, parameters.BCH.fAssetSymbol);
    });

    it("Should represent BCH decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fbch.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.BCH.fAssetDecimals);
    });        
  });

  describe(Contracts.FDGB, async() => {
    let FDGB: FAssetTokenContract;
    let fdgb: FAssetTokenInstance;

    beforeEach(async() => {
      FDGB = artifacts.require("FAssetToken");
      fdgb = await FDGB.at(contracts.getContractAddress(Contracts.FDGB));
    });

    it("Should be a Flare asset representing DGB", async() => {
        // Assemble
        // Act
        const symbol = await fdgb.symbol();
        // Assert
        assert.equal(symbol, parameters.DGB.fAssetSymbol);
    });

    it("Should represent DGB decimals correctly", async() => {
      // Assemble
      // Act
      const decimals = await fdgb.decimals();
      // Assert
      assert.equal(decimals.toNumber(), parameters.DGB.fAssetDecimals);
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


    it("Should be managing a WFLR FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_WFLR));
      // Assert
      assert(found);
    });

    it("Should have goverannace parameters set", async() => {
      // Assemble
      const settings = await ftsoManager.settings();
      // Act
      const minVotePowerFlrThreshold = settings[1];
      const minVotePowerAssetThreshold = settings[2];
      const maxVotePowerFlrThreshold = settings[3];
      const maxVotePowerAssetThreshold = settings[4];
      const lowAssetUSDThreshold = settings[5];
      const highAssetUSDThreshold = settings[6];
      const highAssetTurnoutBIPSThreshold = settings[7];
      const lowFlrTurnoutBIPSThreshold = settings[8];
      // Assert
      assert.equal(minVotePowerFlrThreshold.toNumber(), parameters.minVotePowerFlrThreshold);
      assert.equal(minVotePowerAssetThreshold.toNumber(), parameters.minVotePowerAssetThreshold);
      assert.equal(maxVotePowerFlrThreshold.toNumber(), parameters.maxVotePowerFlrThreshold);
      assert.equal(maxVotePowerAssetThreshold.toNumber(), parameters.maxVotePowerAssetThreshold);
      assert.equal(lowAssetUSDThreshold.toNumber(), parameters.lowAssetUSDThreshold);
      assert.equal(highAssetUSDThreshold.toNumber(), parameters.highAssetUSDThreshold);
      assert.equal(highAssetTurnoutBIPSThreshold.toNumber(), parameters.highAssetTurnoutBIPSThreshold);
      assert.equal(lowFlrTurnoutBIPSThreshold.toNumber(), parameters.lowFlrTurnoutBIPSThreshold);
    });
  });
});