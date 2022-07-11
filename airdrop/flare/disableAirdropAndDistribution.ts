import * as fs from 'fs';
import { signedTransaction } from './utils/airdropTypes';
import { logMessage } from './utils/utils';
import BigNumber from "bignumber.js";
const Web3 = require('web3');
const cliProgress = require('cli-progress');


import InitialAirdropAbi from "../../artifacts/contracts/genesis/implementation/InitialAirdrop.sol/InitialAirdrop.json";
import { InitialAirdrop } from "../../typechain-web3/InitialAirdrop";

import DistributionAbi from "../../artifacts/contracts/tokenPools/implementation/Distribution.sol/Distribution.json";
import { Distribution } from "../../typechain-web3/Distribution";

let { argv } = require("yargs")
.scriptName("disableAirdropAndDistribution")
.option("d", {
  alias: "deployment-name",
  describe: "Deployment file name (generated to deployment/deploys/ folder)",
  type: "string",
  demandOption: "Deployment name is required (-d or --deployment-name)",
  nargs: 1
})
.option("a", {
  alias: "deployment-config",
  describe: "Deployment file name (generated to deployment/chain-config/ folder)",
  type: "string",
  demandOption: "Deployment name is required (-a or --deployment-config)",
  nargs: 1
})
.option("g", {
  alias: "gas",
  describe: "gas per transaction",
  type: "string",
  default: "1000000",
  nargs: 1
})
.option("p", {
  alias: "gas-price",
  describe: "gas price per transaction",
  type: "string",
  default: "25000000000",
  nargs: 1
})
.option("i", {
  alias: "chain-id",
  describe: "chain id for network",
  type: "number",
  demandOption: "Chain id is required (-i or --chain-id)",
  nargs: 1
})
.option("l", {
    alias: "log-path",
    describe: "log data path",
    type: "string",
    default: "airdrop/flare/files/logs/",
    nargs: 1
})
.option("q", {
    alias: "quiet",
    describe: "quiet",
    type: "boolean",
    default: "false",
    nargs: 1
})
.fail(function (msg:any, err:any, yargs:any) {
    if (err) throw err;
    console.error("Exiting with message")
    console.error(msg);
    console.error(yargs.help())
    process.exit(0);
})

async function main(
    deploymentName:string,
    deploymentConfig:string,
    gas:string,
    gasPrice:string,
    chainId: number,
    logPath:string,
    quiet:boolean = true) {
    let initialAirdropSigner: string
    let distributionSigner: string
    let signedTransactions:signedTransaction[] = []

    if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
        initialAirdropSigner = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
    }
    else {
        console.error("No GENESIS_GOVERNANCE_PRIVATE_KEY provided in env");
        throw new Error("No GENESIS_GOVERNANCE_PRIVATE_KEY provided in env");
    }

    if (process.env.DEPLOYER_PRIVATE_KEY) {
        distributionSigner = process.env.DEPLOYER_PRIVATE_KEY
    }
    else {
        console.error("No DEPLOYER_PRIVATE_KEY provided in env");
        throw new Error("No DEPLOYER_PRIVATE_KEY provided in env");
    }

    let web3Provider = ""
    if (process.env.WEB3_PROVIDER_URL) {
        web3Provider = process.env.WEB3_PROVIDER_URL
    }
    else {
        console.error("No WEB3_PROVIDER_URL provided in env");
        throw new Error("No WEB3_PROVIDER_URL provided in env");
    }

    const rawDeploy = fs.readFileSync(deploymentName)
    const contractArray = JSON.parse(rawDeploy as any) as {name: string, contractName: string, address: string} []

    const InitialAirdropAddress = contractArray.find((elem) => elem.contractName === 'InitialAirdrop.sol')?.address || ''
    const DistributionAddress = contractArray.find((elem) => elem.contractName === 'Distribution.sol')?.address || ''

    const deploymentConfigJson = JSON.parse(fs.readFileSync(deploymentConfig, "utf8"))
    const airdropStart = `${deploymentConfigJson.initialAirdropStart}`
    const distributionStart = `${deploymentConfigJson.distributionLatestEntitlementStart}`

    const now = new Date()
    const logFileName = logPath+`${now.toISOString()}_disableAirdropAndDistribution_log.txt`;
    if(!quiet) console.log(logFileName);
    logMessage(logFileName, `Log file created at ${now.toISOString()} GMT(+0)`, quiet);
    logMessage(logFileName, `Script run with `, quiet);
    logMessage(logFileName, `--deployment-name          (-d)                                 : ${deploymentName}`, quiet);
    logMessage(logFileName, `--deployment-config        (-a)                                 : ${deploymentConfig}`, quiet);
    logMessage(logFileName, `--log-path                 (-l)                                 : ${logPath}`, quiet);
    logMessage(logFileName, `Initial airdrop address                                         : ${InitialAirdropAddress}`, quiet);
    logMessage(logFileName, `Distribution address                                            : ${DistributionAddress}`, quiet);
    logMessage(logFileName, `Initial Airdrop start ts                                        : ${airdropStart}`, quiet);
    logMessage(logFileName, `Distribution start ts                                           : ${distributionStart}`, quiet);
    logMessage(logFileName, `Web3 provider url                                               : ${web3Provider}`, quiet);

    const web3 = new Web3(web3Provider);

    const initialAirdropSignerWallet = web3.eth.accounts.privateKeyToAccount(initialAirdropSigner);
    const distributionSignerWallet = web3.eth.accounts.privateKeyToAccount(distributionSigner);
    logMessage(logFileName, `signer public key (from GENESIS_GOVERNANCE_PRIVATE_KEY in .env) : ${initialAirdropSignerWallet.address}`, quiet);
    logMessage(logFileName, `signer public key (from DEPLOYER_PRIVATE_KEY in .env)           : ${distributionSignerWallet.address}`, quiet);

    let InitialAirdropContract: InitialAirdrop
    let DistributionContract: Distribution

    try{
      InitialAirdropContract = new web3.eth.Contract(
        InitialAirdropAbi.abi,
        InitialAirdropAddress
      ) as any as InitialAirdrop;
    }catch(e){
        console.error("Initial Airdrop contract not established");
        throw e
    }

    try{
      DistributionContract = new web3.eth.Contract(
        DistributionAbi.abi,
        DistributionAddress
      ) as any as Distribution;
    }catch(e){
        console.error("Distribution contract not established");
        throw e
    }
   

  // create transaction to disable adding data to initial airdrop
  try{
    const trans = {
      from: initialAirdropSignerWallet.address,
      to: InitialAirdropAddress,
      gas: '0x' + Web3.utils.toBN(gas).toString(16),
      gasPrice: '0x' + Web3.utils.toBN(gasPrice).toString(16),
      chainId: '0x' + Web3.utils.toBN(chainId).toString(16),
      data: InitialAirdropContract.methods.setAirdropStart(airdropStart).encodeABI()
    }
    const signed = await initialAirdropSignerWallet.signTransaction(trans);
    const rec = await web3.eth.sendSignedTransaction(signed.rawTransaction);

    logMessage(logFileName, `${rec}`, quiet);
  } catch (e) {
    console.log(e);
  }

  try{
    const trans = {
      from: distributionSignerWallet.address,
      to: DistributionAddress,
      gas: '0x' + Web3.utils.toBN(gas).toString(16),
      gasPrice: '0x' + Web3.utils.toBN(gasPrice).toString(16),
      chainId: '0x' + Web3.utils.toBN(chainId).toString(16),
      data: DistributionContract.methods.setEntitlementStart(distributionStart).encodeABI()
    }
    const signed = await distributionSignerWallet.signTransaction(trans);
    const rec = await web3.eth.sendSignedTransaction(signed.rawTransaction);
    logMessage(logFileName, `${rec}`, quiet);
  } catch (e) {
    console.log(e);
  }
    logMessage(logFileName, `Complete`, quiet);
}
  
const { quiet, logPath, deploymentName, deploymentConfig, gas, gasPrice, chainId} = argv;
main( deploymentName, deploymentConfig, gas, gasPrice, chainId, logPath, quiet )
.then(() => process.exit(0))
.catch(error => {
    console.error(error);
    process.exit(1);
});
  