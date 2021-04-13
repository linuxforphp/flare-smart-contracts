const {constants} = require('@openzeppelin/test-helpers');

import { ReadStream } from "node:fs";
import { DummyFAssetMinterContract, 
  FAssetTokenContract,
  FtsoContract,
  FlareKeeperContract,
  RewardManagerContract,
  WFLRContract } from "../../../typechain-truffle";

const BN = web3.utils.toBN;

async function read(stream: ReadStream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk); 
  return Buffer.concat(chunks).toString('utf-8');
}

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
    const contractsJson = await read(stream);
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
    it("Should know the reward manager", async() => {
        // Assemble
        const Inflation = artifacts.require("Inflation");
        const inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
        // Act
        const rewardManager = await inflation.rewardManager();
        // Assert
        // If the keeper is calling keep on the RewardManager, then there should be
        // an active reward epoch.
        assert.equal(rewardManager, contracts.getContractAddress(Contracts.REWARD_MANAGER));
    });
  });

  describe(Contracts.WFLR, async() => {
    it("Should accept deposits", async() => {
        // Assemble
        const WFLR = artifacts.require("WFLR") as WFLRContract;
        const wflr = await WFLR.at(contracts.getContractAddress(Contracts.WFLR));
        // Act
        await wflr.deposit({from: accounts[1], value: BN(10)})
        // Assert
        const balance = await wflr.balanceOf(accounts[1])
        assert.equal(balance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FXRP_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFxrpMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFxrpMinter = await DummyFxrpMinter.at(contracts.getContractAddress(Contracts.DUMMY_FXRP_MINTER));
        const FXRP = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fxrp = await FXRP.at(contracts.getContractAddress(Contracts.FXRP));
        // Act
        await dummyFxrpMinter.mintRequest(10, accounts[1], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fxrp.balanceOf(accounts[1])
        assert.equal(balance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FLTC_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFltcMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFltcMinter = await DummyFltcMinter.at(contracts.getContractAddress(Contracts.DUMMY_FLTC_MINTER));
        const FLTC = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fltc = await FLTC.at(contracts.getContractAddress(Contracts.FLTC));
        // Act
        await dummyFltcMinter.mintRequest(10, accounts[2], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fltc.balanceOf(accounts[2])
        assert.equal(balance.toNumber(), 10);
    });
  });

  describe(Contracts.DUMMY_FXDG_MINTER, async() => {
    it("Should mint", async() => {
        // Assemble
        const DummyFxdgMinter = artifacts.require("DummyFAssetMinter") as DummyFAssetMinterContract;
        const dummyFxdgMinter = await DummyFxdgMinter.at(contracts.getContractAddress(Contracts.DUMMY_FXDG_MINTER));
        const FXDG = artifacts.require("FAssetToken") as FAssetTokenContract;
        const fxdg = await FXDG.at(contracts.getContractAddress(Contracts.FXDG));
        // Act
        await dummyFxdgMinter.mintRequest(10, accounts[3], constants.ZERO_ADDRESS);
        // Assert
        const balance = await fxdg.balanceOf(accounts[3])
        assert.equal(balance.toNumber(), 10);
    });
  });

  describe(Contracts.FTSO_FXRP_WFLR, async() => {
    it("Should be on oracle for FXRP", async() => {
        // Assemble
        const FtsoFxrpWflr = artifacts.require("Ftso") as FtsoContract;
        const ftsoFxrpWflr = await FtsoFxrpWflr.at(contracts.getContractAddress(Contracts.FTSO_FXRP_WFLR));
        // Act
        const address = await ftsoFxrpWflr.getFAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FXRP));
    });
  });
   
  describe(Contracts.FTSO_FLTC_WFLR, async() => {
    it("Should be on oracle for FLTC", async() => {
        // Assemble
        const FtsoFltcWflr = artifacts.require("Ftso") as FtsoContract;
        const ftsoFltcWflr = await FtsoFltcWflr.at(contracts.getContractAddress(Contracts.FTSO_FLTC_WFLR));
        // Act
        const address = await ftsoFltcWflr.getFAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FLTC));
    });
  });

  describe(Contracts.FTSO_FXDG_WFLR, async() => {
    it("Should be on oracle for FXDG", async() => {
        // Assemble
        const FtsoFxdgWflr = artifacts.require("Ftso") as FtsoContract;
        const ftsoFxdgWflr = await FtsoFxdgWflr.at(contracts.getContractAddress(Contracts.FTSO_FXDG_WFLR));
        // Act
        const address = await ftsoFxdgWflr.getFAsset();
        // Assert
        assert.equal(address, contracts.getContractAddress(Contracts.FXDG));
    });
  });    
});