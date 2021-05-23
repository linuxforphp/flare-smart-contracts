import { FlareNetworkGeneralLedgerInstance, 
  MintAccountingInstance,
  FtsoInflationAccountingInstance } from "../../../typechain-truffle";
import { FlareNetworkChartOfAccounts } from "../../utils/Accounting";

const { constants, expectRevert } = require('@openzeppelin/test-helpers');

const getTestFile = require('../../utils/constants').getTestFile;

const FlareNetworkGeneralLedger = artifacts.require("FlareNetworkGeneralLedger");
const FtsoInflationAccounting = artifacts.require("FtsoInflationAccounting");
const MintAccounting = artifacts.require("MintAccounting");

contract(`FtsoInflationAccounting.sol; ${getTestFile(__filename)}; Ftso reward inflation accounting integration tests`, async accounts => {
  // contains a fresh contract for each test
  let gl: FlareNetworkGeneralLedgerInstance;
  let mintAccounting: MintAccountingInstance;
  let ftsoInflationAccounting: FtsoInflationAccountingInstance;

  beforeEach(async() => {
    gl = await FlareNetworkGeneralLedger.new(accounts[0]);
    mintAccounting = await MintAccounting.new(accounts[0], gl.address);
    await mintAccounting.grantRole(await mintAccounting.POSTER_ROLE(), accounts[0]);
    ftsoInflationAccounting = await FtsoInflationAccounting.new(accounts[0], gl.address);
    await ftsoInflationAccounting.grantRole(await ftsoInflationAccounting.POSTER_ROLE(), accounts[0]);
    gl.grantRole(await gl.POSTER_ROLE(), mintAccounting.address);
    gl.grantRole(await gl.POSTER_ROLE(), ftsoInflationAccounting.address);
  });

  describe("post", async() => {
    it("Should authorize minting", async() => {
      // Assemble
      // Act
      await ftsoInflationAccounting.authorizeMinting(1000);
      // Assert
      const mintingAuthorized = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED);
      const inflationPayable = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE);
      assert.equal(mintingAuthorized.toNumber(), 1000);
      assert.equal(inflationPayable.toNumber(), 1000);
    });

    it("Should receive minting", async() => {
      // Assemble
      await ftsoInflationAccounting.authorizeMinting(1000);
      await mintAccounting.requestMinting(50);
      await mintAccounting.receiveMinting(50);
      // Act
      await ftsoInflationAccounting.receiveMinting(50);
      // Assert
      const mintingAuthorized = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTING_AUTHORIZED);
      const minted = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.MINTED);
      const inflationPayable = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE);
      const inflationEquity = await gl.getCurrentBalance(FlareNetworkChartOfAccounts.FTSO_REWARD_INFLATION_TOKEN);
      assert.equal(mintingAuthorized.toNumber(), 950);
      assert.equal(minted.toNumber(), 50);
      assert.equal(inflationPayable.toNumber(), 950);
      assert.equal(inflationEquity.toNumber(), 50);
    });    
  });

  describe("calculate", async() => {
    it("Should calculate minted FLR resulting from Ftso reward inflation", async() => {
      // Assemble
      await ftsoInflationAccounting.authorizeMinting(1000);
      await ftsoInflationAccounting.receiveMinting(50);
      // Act
      const mintedInflationBalance: BN = await ftsoInflationAccounting.getMintedInflationBalance() as any;
      // Assert
      assert.equal(mintedInflationBalance.toNumber(), 50);
    });

    it("Should calculate minted and unminted FLR resulting from Ftso reward inflation", async() => {
      // Assemble
      await ftsoInflationAccounting.authorizeMinting(1000);
      await ftsoInflationAccounting.receiveMinting(50);
      // Act
      const inflationBalance: BN = await ftsoInflationAccounting.getInflationBalance() as any;
      // Assert
      assert.equal(inflationBalance.toNumber(), 1000);
    });    

    it("Should calculate unminted FLR resulting from Ftso reward inflation", async() => {
      // Assemble
      await ftsoInflationAccounting.authorizeMinting(1000);
      await ftsoInflationAccounting.receiveMinting(50);
      // Act
      const unmintedInflationBalance: BN = await ftsoInflationAccounting.getUnmintedInflationBalance() as any;
      // Assert
      assert.equal(unmintedInflationBalance.toNumber(), 950);
    });        
  });  
});
