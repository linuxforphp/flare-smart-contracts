import { Readable } from "stream";

export class Contract {
  name: string;
  contractName: string;
  address: string;

  constructor(name: string, contractName: string, address: string) {
    this.name = name;
    this.contractName = contractName;
    this.address = address;
  }
}

export class Contracts {
  private contracts: Map<string, Contract>;

  private static WRAP_SYMBOL = "f";
  private static WRAP_SYMBOL_MINT = "";
  public static readonly GOVERNANCE_SETTINGS = "GovernanceSettings";
  public static readonly ADDRESS_UPDATER = "AddressUpdater";
  public static readonly CLEANUP_BLOCK_NUMBER_MANAGER = "CleanupBlockNumberManager";
  public static readonly FTSO_REGISTRY = "FtsoRegistry";
  public static readonly DISTRIBUTION = "Distribution";
  public static readonly DISTRIBUTION_TREASURY = "DistributionTreasury";
  public static readonly DISTRIBUTION_TO_DELEGATORS = "DistributionToDelegators";
  public static readonly INCENTIVE_POOL_TREASURY = "IncentivePoolTreasury";
  public static readonly INCENTIVE_POOL = "IncentivePool";
  public static readonly INCENTIVE_POOL_ALLOCATION = "IncentivePoolAllocation";
  public static readonly INITIAL_AIRDROP = "InitialAirdrop";
  public static readonly DELEGATION_ACCOUNT_MANAGER = "DelegationAccountManager";
  public static readonly ESCROW = "Escrow";
  public static readonly SUPPLY = "Supply";
  public static readonly INFLATION_ALLOCATION = "InflationAllocation";
  public static readonly INFLATION = "Inflation";
  public static readonly FTSO_REWARD_MANAGER = "FtsoRewardManager";
  public static readonly PRICE_SUBMITTER = "PriceSubmitter";
  public static readonly FTSO_MANAGER = "FtsoManager";
  public static readonly STATE_CONNECTOR = "StateConnector";
  public static readonly VOTER_WHITELISTER = "VoterWhitelister";
  public static readonly FLARE_DAEMON = "FlareDaemon";
  public static readonly WNAT = "WNat";
  public static readonly GOVERNANCE_VOTE_POWER = "GovernanceVotePower";
  public static readonly FTSO_WNAT = "FtsoWnat";
  public static readonly XRP = `${Contracts.WRAP_SYMBOL}XRP` 
  public static readonly DUMMY_XRP_MINTER = `Dummy${Contracts.WRAP_SYMBOL_MINT}XrpMinter`;
  public static readonly FTSO_XRP = "FtsoXrp";
  public static readonly LTC = `${Contracts.WRAP_SYMBOL}LTC`;
  public static readonly DUMMY_LTC_MINTER = `Dummy${Contracts.WRAP_SYMBOL_MINT}LtcMinter`;
  public static readonly FTSO_LTC = "FtsoLtc";
  public static readonly DOGE = `${Contracts.WRAP_SYMBOL}DOGE`;
  public static readonly DUMMY_DOGE_MINTER = `Dummy${Contracts.WRAP_SYMBOL_MINT}DogeMinter`;
  public static readonly FTSO_DOGE = "FtsoDoge"; 
  public static readonly ADA = `${Contracts.WRAP_SYMBOL}ADA`;
  public static readonly DUMMY_ADA_MINTER = `Dummy${Contracts.WRAP_SYMBOL_MINT}AdaMinter`;
  public static readonly FTSO_ADA = "FtsoAda";
  public static readonly ALGO = `${Contracts.WRAP_SYMBOL}ALGO`;
  public static readonly DUMMY_ALGO_MINTER = `Dummy${Contracts.WRAP_SYMBOL_MINT}AlgoMinter`;
  public static readonly FTSO_ALGO = "FtsoAlgo";
  public static readonly BCH = `${Contracts.WRAP_SYMBOL}BCH`;
  public static readonly DUMMY_BCH_MINTER = `Dummy${Contracts.WRAP_SYMBOL_MINT}BchMinter`;
  public static readonly FTSO_BCH = "FtsoBch";
  public static readonly DGB = `${Contracts.WRAP_SYMBOL}DGB`;
  public static readonly DUMMY_DGB_MINTER = `Dummy${Contracts.WRAP_SYMBOL_MINT}DgbMinter`;
  public static readonly FTSO_DGB = "FtsoDgb";
  // NOTE: this is not exhaustive list. Constants here are defined on on-demand basis (usually motivated by tests).

  constructor() {
    // Maps a contract name to a Contract object
    this.contracts = new Map<string, Contract>();
  }

  deserializeFile(filePath: string) {
    const fs = require("fs");
    if (!fs.existsSync(filePath)) return;
    const contractsJson = fs.readFileSync(filePath);
    if (contractsJson.length == 0) return;
    this.deserializeJson(contractsJson);
  }

  async deserialize(stream: Readable) {
    const contractsJson = await this.readStream(stream);
    this.deserializeJson(contractsJson);
  }
  
  deserializeJson(contractsJson: string) {
    const parsedContracts = JSON.parse(contractsJson);
    parsedContracts.forEach((contract: { name: string; contractName: string, address: string; }) => {
      this.contracts.set(contract.name, contract);
    })
  }
  
  allContracts(): Contract[] {
    return Array.from(this.contracts.values());
  }

  getContractAddress(name: string): string {
    if (this.contracts.has(name)) {
      return this.contracts.get(name)!.address;
    } else {
      throw new Error(`${name} not found`);
    }
  }
  
  async getContractsMap(hre: any): Promise<any> {
    const contractsMap: any = {};
    for (let con of this.allContracts()) {
      const name = con.contractName.split(".")[0];
      const alias = con.name[0].toLowerCase() + con.name.slice(1);
      const contract = hre.artifacts.require(name as any);
      contractsMap[alias] = await contract.at(con.address);
    }
    return contractsMap;
  }

  async readStream(stream: Readable) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk); 
    return Buffer.concat(chunks).toString('utf-8');
  }

  add(contract: Contract) {
    this.contracts.set(contract.name, contract);
  }

  serialize(): string {
    return JSON.stringify(this.allContracts(), null, 2);
  }
}
