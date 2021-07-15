// import { ReadStream } from "node:fs";
import { ReadStream } from "fs";

export class Contract {
  name: string;
  address: string;

  constructor(name: string, address: string) {
    this.name = name;
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
  public static readonly VALIDATOR_REWARD_MANAGER = "ValidatorRewardManager";
  public static readonly PRICE_SUBMITTER = "PriceSubmitter";
  public static readonly FTSO_MANAGER = "FtsoManager";
  public static readonly STATE_CONNECTOR = "StateConnector";
  public static readonly VOTER_WHITELISTER = "VoterWhitelister";
  public static readonly FLARE_KEEPER = "FlareKeeper";
  public static readonly WFLR = "WFlr";
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
    // Maps a contract name to an address
    this.contracts = new Map<string, string>();
    this.collection = [];
  }

  async deserialize(stream: any) {
    const contractsJson = await this.read(stream);
    const parsedContracts = JSON.parse(contractsJson);
    parsedContracts.forEach((contract: { name: string; address: string; }) => {
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
