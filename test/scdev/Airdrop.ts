import { timeStamp } from "console";
import {
  DistributionContract,
  DistributionInstance
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
  let seenFLRAddressesDetail: {[name: string]: BN } = {};
  let seenFLRAddresses:Set<string> = new Set();
  for(let XRPLine of parsed_file){
    if(!seenFLRAddresses.has(XRPLine.FlareAddress)){
      seenFLRAddresses.add(XRPLine.FlareAddress);
      seenFLRAddressesDetail[XRPLine.FlareAddress] = BN(XRPLine.FlareBalance);
    } 
    else {
      seenFLRAddressesDetail[XRPLine.FlareAddress] =seenFLRAddressesDetail[XRPLine.FlareAddress].add(BN(XRPLine.FlareBalance));
    }    
  }
  let processedFile:ProcessedLineItem[] = []
  for(let flrAdd of seenFLRAddresses){
    let tempTotal = seenFLRAddressesDetail[flrAdd];
    let tempAirdrop = tempTotal.muln(15).divn(100);
    processedFile.push(
        {
          FlareAddress: flrAdd,
          totalFlareBalance: tempTotal,
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

  let Distribution: DistributionContract;
  let distribution: DistributionInstance;

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
    Distribution = artifacts.require("Distribution");
    distribution = await Distribution.new();
    await distribution.initialiseFixedAddress();

    parsedAirdrop = parseAndProcessData("test/scdev/airdropUtils/export.csv");
  });

  it(`Test Initial airdrop accounting`, async function(){
    console.log("Testing initial airdrop accounting");
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar1.start(parsedAirdrop.length, 0);
    let progress = 0;
    for(let FlareItem of parsedAirdrop){
      if (IsAddress(FlareItem.FlareAddress)){
        let actualBalance = await GetBalance(FlareItem.FlareAddress);
        assert.equal(actualBalance,FlareItem.initialAirdropBalance.toString())
      }
      progress += 1;
      bar1.update(progress);
    }
    bar1.stop();
  })

  it("Test all time distribution and airdrop accounting" ,async function(){
    console.log("Adding account to distribution contract");
    let totalFlare = BN(0);
    const BATCH_SIZE = 1000;
    const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    let distributionTransactions = (parsedAirdrop.length/BATCH_SIZE + 1)
    bar1.start(distributionTransactions.toFixed(0), 0);
    for(let i = 0; i < distributionTransactions; i++){
      let currentAccounts = [];
      let currentBalances = [];
      for(let j = 0; j < Math.min(BATCH_SIZE,parsedAirdrop.length-BATCH_SIZE*i); j++){
        if (IsAddress(parsedAirdrop[i*BATCH_SIZE+j].FlareAddress)){
          currentAccounts.push(parsedAirdrop[i*BATCH_SIZE+j].FlareAddress)
          currentBalances.push(parsedAirdrop[i*BATCH_SIZE+j].totalFlareBalance)
          totalFlare = totalFlare.add(parsedAirdrop[i*BATCH_SIZE+j].totalFlareBalance.muln(85).divn(100));
        }
      }
      await distribution.setClaimBalance(currentAccounts,currentBalances, {from: genesisGovernanceAccount.address});
      bar1.update(i);
    }
    bar1.stop();

    console.log("Send required funds to Distribution contract");
    // Hacky way of doing this
    const suicidalMock = await SuicidalMock.new(distribution.address);
    await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: totalFlare});
    await suicidalMock.die();

    console.log("Balance accounting");
    assert.equal((await distribution.totalEntitlementWei()).toString(),(await GetBalance(distribution.address)).toString());
    
    console.log("Start entitlement process in the past (to simulate the future)");
    let now = await time.latest();
    let backInTime = now.sub(BN(30*24*60*60).muln(29));
    await distribution.setEntitlementStart(backInTime, {from: genesisGovernanceAccount.address});

    console.log("Do the accounting for distribution contract");
    const bar2 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar2.start(parsedAirdrop.length, 0);
    let progress = 0;
    for(let FlareItem of parsedAirdrop){
        if (IsAddress(FlareItem.FlareAddress)){
          let actualBalance = await distribution.getClaimableAmountOf(FlareItem.FlareAddress);
          assert.isTrue(actualBalance.eq(FlareItem.totalDistributionBalance));
        }
      progress += 1;
      bar2.update(progress);
    }
    bar2.stop();
    
    console.log("Check that airdrop + distribution are the same as total");
    const bar3 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar3.start(parsedAirdrop.length, 0);
    progress = 0;
    for(let FlareItem of parsedAirdrop){
        if (IsAddress(FlareItem.FlareAddress)){
          let distributionBalance = await distribution.getClaimableAmountOf(FlareItem.FlareAddress);
          let airdropBalance = await GetBalance(FlareItem.FlareAddress);
          let actualBalance = distributionBalance.add(BN(airdropBalance));
          assert.isTrue(actualBalance.eq(FlareItem.totalFlareBalance));
        }
      progress += 1;
      bar3.update(progress);
    }
    bar3.stop();
  });
});