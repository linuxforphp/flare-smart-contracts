// import { ReadStream } from "node:fs";
import { ReadStream } from "fs";

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
  private contracts: Map<string, string>;
  private collection: Contract[];

  private static WRAP_SYMBOL = "f";
  private static WRAP_SYMBOL_MINT = "";
  public static readonly ADDRESS_UPDATER = "AddressUpdater";
  public static readonly FTSO_V2_SWITCHER = "FtsoV2Switcher";
  public static readonly CLEANUP_BLOCK_NUMBER_MANAGER = "CleanupBlockNumberManager";
  public static readonly FTSO_REGISTRY = "FtsoRegistry";
  public static readonly DISTRIBUTION = "Distribution";
  public static readonly SUPPLY = "Supply";
  public static readonly INFLATION_ALLOCATION = "InflationAllocation";
  public static readonly INFLATION = "Inflation";
  public static readonly FTSO_REWARD_MANAGER = "FtsoRewardManager";
  public static readonly DATA_AVAILABILITY_REWARD_MANAGER = "DataAvailabilityRewardManager";
  public static readonly PRICE_SUBMITTER = "PriceSubmitter";
  public static readonly FTSO_MANAGER = "FtsoManager";
  public static readonly STATE_CONNECTOR = "StateConnector";
  public static readonly VOTER_WHITELISTER = "VoterWhitelister";
  public static readonly FLARE_DAEMON = "FlareDaemon";
  public static readonly WNAT = "WNat";
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
    // Maps a contract name to an address
    this.contracts = new Map<string, string>();
    this.collection = [];
  }

  async deserialize(stream: any) {
    const contractsJson = await this.read(stream);
    const parsedContracts = JSON.parse(contractsJson);
    parsedContracts.forEach((contract: { name: string; contractName: string, address: string; }) => {
      this.contracts.set(contract.name, contract.address);
      this.collection.push(contract);
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

  add(contract: Contract) {
    this.collection.push(contract);
    this.contracts.set(contract.name, contract.address);
  }

  serialize(): string {
    return JSON.stringify(this.collection, null, 2);
  }
}
