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
  public static readonly XRP = "Xrp";
  public static readonly DUMMY_XRP_MINTER = "DummyXrpMinter";
  public static readonly FTSO_XRP = "FtsoXrp";
  public static readonly LTC = "Ltc";
  public static readonly DUMMY_LTC_MINTER = "DummyLtcMinter";
  public static readonly FTSO_LTC = "FtsoLtc";
  public static readonly DOGE = "Doge";
  public static readonly DUMMY_DOGE_MINTER = "DummyDogeMinter";
  public static readonly FTSO_DOGE = "FtsoDoge";
  public static readonly FTSO_WNAT = "FtsoWnat";
  public static readonly ADA = "Ada";
  public static readonly DUMMY_ADA_MINTER = "DummyAdaMinter";
  public static readonly FTSO_ADA = "FtsoAda";
  public static readonly ALGO = "Algo";
  public static readonly DUMMY_ALGO_MINTER = "DummyAlgoMinter";
  public static readonly FTSO_ALGO = "FtsoAlgo";
  public static readonly BCH = "Bch";
  public static readonly DUMMY_BCH_MINTER = "DummyBchMinter";
  public static readonly FTSO_BCH = "FtsoBch";
  public static readonly DGB = "Dgb";
  public static readonly DUMMY_DGB_MINTER = "DummyDgbMinter";
  public static readonly FTSO_DGB = "FtsoDgb";

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
