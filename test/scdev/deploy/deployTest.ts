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
  public static readonly FTSO_MANAGER = "FtsoManager";
  public static readonly FLARE_KEEPER = "FlareKeeper";
  public static readonly WFLR = "Wflr";
  public static readonly FXRP = "Fxrp";
  public static readonly DUMMY_FXRP_MINTER = "DummyFxrpMinter";
  public static readonly FTSO_FXRP_WFLR = "FtsoFxrpWflr";
  public static readonly FLTC = "Fltc";
  public static readonly DUMMY_FLTC_MINTER = "DummyFltcMinter";
  public static readonly FTSO_FLTC_WFLR = "FtsoFltcWflr";
  public static readonly FXDG = "Fxdg";
  public static readonly DUMMY_FXDG_MINTER = "DummyFxdgMinter";
  public static readonly FTSO_FXDG_WFLR = "FtsoFxdgWflr";
  public static readonly FTSO_WFLR = "FtsoWflr";

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
    it("Should by kept by keeper", async() => {
        // Assemble
        const FtsoManager = artifacts.require("FtsoManager");
        const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
        // Act
        const startBlock = (await ftsoManager.rewardEpochs(0))[0];
        // Assert
        // If the keeper is calling keep on the RewardManager, then there should be
        // an active reward epoch.
        assert(startBlock.toNumber() != 0);
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

    it("Should know about XRP FAsset FTSO", async() => {
      // Assemble
      // Act
      const found = await findFAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXRP_WFLR));
      // Assert
      assert(found);
    });    

    it("Should know about LTC FAsset FTSO", async() => {
      // Assemble
      // Act
      const found = await findFAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FLTC_WFLR));
      // Assert
      assert(found);
    });    

    it("Should know about XDG FAsset FTSO", async() => {
      // Assemble
      // Act
      const found = await findFAssetFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXDG_WFLR));
      // Assert
      assert(found);
    });    
  });

  describe(Contracts.FTSO_FXRP_WFLR, async() => {
    let FtsoFxrpWflr: FtsoContract;
    let ftsoFxrpWflr: FtsoInstance;

    beforeEach(async() => {
      FtsoFxrpWflr = artifacts.require("Ftso");
      ftsoFxrpWflr = await FtsoFxrpWflr.at(contracts.getContractAddress(Contracts.FTSO_FXRP_WFLR));
    });

    it("Should be on oracle for FXRP", async() => {
        // Assemble
        // Act
        const address = await ftsoFxrpWflr.getFAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FXRP));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFxrpWflr.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });
  });
   
  describe(Contracts.FTSO_FLTC_WFLR, async() => {
    let FtsoFltcWflr: FtsoContract;
    let ftsoFltcWflr: FtsoInstance;

    beforeEach(async() => {
      FtsoFltcWflr = artifacts.require("Ftso");
      ftsoFltcWflr = await FtsoFltcWflr.at(contracts.getContractAddress(Contracts.FTSO_FLTC_WFLR));
    });

    it("Should be on oracle for FLTC", async() => {
        // Assemble
        // Act
        const address = await ftsoFltcWflr.getFAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FLTC));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFltcWflr.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
    });    
  });

  describe(Contracts.FTSO_FXDG_WFLR, async() => {
    let FtsoFxdgWflr: FtsoContract;
    let ftsoFxdgWflr: FtsoInstance;

    beforeEach(async() => {
      FtsoFxdgWflr = artifacts.require("Ftso");
      ftsoFxdgWflr = await FtsoFxdgWflr.at(contracts.getContractAddress(Contracts.FTSO_FXDG_WFLR));
    });
    
    it("Should be on oracle for FXDG", async() => {
        // Assemble
        // Act
        const address = await ftsoFxdgWflr.getFAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FXDG));
    });

    it("Should be managed", async() => {
      // Assemble
      // Act
      const ftsoManager = await ftsoFxdgWflr.ftsoManager();
      // Assert
      assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
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
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXRP_WFLR));
      // Assert
      assert(found);
    });

    it("Should be managing an LTC FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FLTC_WFLR));
      // Assert
      assert(found);
    });            

    it("Should be managing an XDG FTSO", async() => {
      // Assemble
      // Act
      const found = await findFtso(contracts, contracts.getContractAddress(Contracts.FTSO_FXDG_WFLR));
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
      const minVoteCount = settings[0];
      const minVotePowerFlrThreshold = settings[2];
      const minVotePowerAssetThreshold = settings[3];
      const maxVotePowerFlrThreshold = settings[4];
      const maxVotePowerAssetThreshold = settings[5];
      const lowAssetUSDThreshold = settings[6];
      const highAssetUSDThreshold = settings[7];
      const highAssetTurnoutThreshold = settings[8];
      // Assert
      assert.equal(minVoteCount.toNumber(), parameters.minVoteCount);
      assert.equal(minVotePowerFlrThreshold.toNumber(), parameters.minVotePowerFlrThreshold);
      assert.equal(minVotePowerAssetThreshold.toNumber(), parameters.minVotePowerAssetThreshold);
      assert.equal(maxVotePowerFlrThreshold.toNumber(), parameters.maxVotePowerFlrThreshold);
      assert.equal(maxVotePowerAssetThreshold.toNumber(), parameters.maxVotePowerAssetThreshold);
      assert.equal(lowAssetUSDThreshold.toNumber(), parameters.lowAssetUSDThreshold);
      assert.equal(highAssetUSDThreshold.toNumber(), parameters.highAssetUSDThreshold);
      assert.equal(highAssetTurnoutThreshold.toNumber(), parameters.highAssetTurnoutThreshold);
    });
  });
});