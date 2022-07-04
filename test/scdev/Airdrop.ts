import { timeStamp } from "console";
import {
  DistributionMockContract,
  DistributionMockInstance,
  DistributionTreasuryContract,
  DistributionTreasuryInstance
} from "../../typechain-truffle";
import { LineItem, ProcessedLineItem } from "./airdropUtils/utils";
const parse = require('csv-parse/lib/sync');
const fs = require("fs");
const getTestFile = require('../utils/constants').getTestFile;
const BN = web3.utils.toBN;
const GetBalance = web3.eth.getBalance;
const IsAddress = web3.utils.isAddress;
const cliProgress = require('cli-progress');
const SuicidalMock = artifacts.require("SuicidalMock");
import { time } from '@openzeppelin/test-helpers';
import { expect } from "hardhat";
const calcGasCost = require('../utils/eth').calcGasCost; 

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const parameters = require(`../../deployment/chain-config/${ process.env.CHAIN_CONFIG }.json`)
// inject private keys from .env, if they exist
if (process.env.DEPLOYER_PRIVATE_KEY) {
  parameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
}
if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
  parameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
}
if (process.env.GOVERNANCE_PRIVATE_KEY) {
  parameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
}

function parseAndProcessData(dataFile:string):ProcessedLineItem[] {
  let data = fs.readFileSync(dataFile, "utf8");
  const parsed_file:LineItem[] = parse( data, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ',',
    skip_lines_with_error: true
  })
  let seenNATAddressesDetail: {[name: string]: BN } = {};
  let seenNATAddresses:Set<string> = new Set();
  for(let XRPLine of parsed_file){
    if(!seenNATAddresses.has(XRPLine.FlareAddress)){
      seenNATAddresses.add(XRPLine.FlareAddress);
      seenNATAddressesDetail[XRPLine.FlareAddress] = BN(XRPLine.FlareBalance);
    } 
    else {
      seenNATAddressesDetail[XRPLine.FlareAddress] =seenNATAddressesDetail[XRPLine.FlareAddress].add(BN(XRPLine.FlareBalance));
    }    
  }
  let processedFile:ProcessedLineItem[] = []
  for(let natAdd of seenNATAddresses){
    let tempTotal = seenNATAddressesDetail[natAdd];
    let tempAirdrop = tempTotal.muln(15).divn(100);
    processedFile.push(
        {
          NativeAddress: natAdd,
          totalNativeBalance: tempTotal,
          initialAirdropBalance: tempAirdrop,
          distributionMonthlyBalance: tempTotal.muln(3).divn(100),
          totalDistributionBalance: tempTotal.sub(tempAirdrop),
        }
    ) 
  }
  return processedFile;
}

contract(`Airdrop testing: ${getTestFile(__filename)}; Initial Airdrop and Distribution contract tests`, async accounts => {
  let deployerAccount: any;
  let governanceAccount: any;
  let genesisGovernanceAccount: any;

  let DistributionTreasury: DistributionTreasuryContract;
  let distributionTreasury: DistributionTreasuryInstance;
  let Distribution: DistributionMockContract;
  let distribution: DistributionMockInstance;

  let parsedAirdrop: ProcessedLineItem[];

  before(async() => {
    try {
      deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
      governanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);
      genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.genesisGovernancePrivateKey);
    } catch (e) {
      throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
    }
    web3.eth.defaultAccount = deployerAccount.address;

    // Contract artifact definitions
    DistributionTreasury = artifacts.require("DistributionTreasury");
    Distribution = artifacts.require("DistributionMock");
    distributionTreasury = await DistributionTreasury.new();
    await distributionTreasury.initialiseFixedAddress();
    distribution = await Distribution.new(genesisGovernanceAccount, distributionTreasury.address, (await time.latest()).addn(10*24*60*60));

    parsedAirdrop = parseAndProcessData("../../airdrop/data/export.csv");
  });

  it(`Test Initial airdrop accounting`, async function(){
    console.log("Testing initial airdrop accounting");
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar1.start(parsedAirdrop.length, 0);
    let progress = 0;
    for(let NativeItem of parsedAirdrop){
      if (IsAddress(NativeItem.NativeAddress)){
        let actualBalance = await GetBalance(NativeItem.NativeAddress);
        assert.equal(actualBalance,NativeItem.initialAirdropBalance.toString())
      }
      progress += 1;
      bar1.update(progress);
    }
    bar1.stop();
  })

  it("Test all time distribution and airdrop accounting" ,async function(){
    console.log("Adding account to distribution contract");
    let totalNative = BN(0);
    const BATCH_SIZE = 1000;
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    let distributionTransactions = (parsedAirdrop.length/BATCH_SIZE + 1)
    bar1.start(distributionTransactions.toFixed(0), 0);
    for(let i = 0; i < distributionTransactions; i++){
      let currentAccounts = [];
      let currentBalances = [];
      for(let j = 0; j < Math.min(BATCH_SIZE,parsedAirdrop.length-BATCH_SIZE*i); j++){
        if (IsAddress(parsedAirdrop[i*BATCH_SIZE+j].NativeAddress)){
          currentAccounts.push(parsedAirdrop[i*BATCH_SIZE+j].NativeAddress)
          currentBalances.push(parsedAirdrop[i*BATCH_SIZE+j].totalNativeBalance)
          totalNative = totalNative.add(parsedAirdrop[i*BATCH_SIZE+j].totalNativeBalance.muln(85).divn(100));
        }
      }
      await distribution.setAirdropBalances(currentAccounts,currentBalances, {from: genesisGovernanceAccount.address});
      bar1.update(i);
    }
    bar1.stop();

    console.log("Send required funds to DistributionTreasury contract");
    // Hacky way of doing this
    const suicidalMock = await SuicidalMock.new(distributionTreasury.address);
    await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: totalNative});
    await suicidalMock.die();
    assert.equal((await distribution.totalEntitlementWei()).toString(),(await GetBalance(distributionTreasury.address)).toString());

    console.log("Set distribution contract on distribution treasury");
    await distributionTreasury.setContracts(distribution.address, accounts[100], {from: genesisGovernanceAccount.address});
    await distributionTreasury.selectDistributionContract(distribution.address, {from: genesisGovernanceAccount.address});
    
    console.log("Start entitlement process in the past (to simulate the future)");
    let now = await time.latest();
    let backInTime = now.sub(BN(30*24*60*60).muln(29));
    await distribution.setEntitlementStart(backInTime, {from: genesisGovernanceAccount.address});

    console.log("Balance accounting");
    assert.equal((await distribution.totalEntitlementWei()).toString(),(await GetBalance(distribution.address)).toString());

    console.log("Do the accounting for distribution contract");
    const bar2 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar2.start(parsedAirdrop.length, 0);
    let progress = 0;
    for(let NativeItem of parsedAirdrop){
        if (IsAddress(NativeItem.NativeAddress)){
          let actualBalance = await distribution.getClaimableAmountOf(NativeItem.NativeAddress);
          assert.isTrue(actualBalance.eq(NativeItem.totalDistributionBalance));
        }
      progress += 1;
      bar2.update(progress);
    }
    bar2.stop();
    
    console.log("Check that airdrop + distribution are the same as total");
    const bar3 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar3.start(parsedAirdrop.length, 0);
    progress = 0;
    for(let NativeItem of parsedAirdrop){
        if (IsAddress(NativeItem.NativeAddress)){
          let distributionBalance = await distribution.getClaimableAmountOf(NativeItem.NativeAddress);
          let airdropBalance = await GetBalance(NativeItem.NativeAddress);
          let actualBalance = distributionBalance.add(BN(airdropBalance));
          assert.isTrue(actualBalance.eq(NativeItem.totalNativeBalance));
        }
      progress += 1;
      bar3.update(progress);
    }
    bar3.stop();
  });
});