/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { FlareDaemonContract } from "../../typechain-truffle";

const parameters = require(`../chain-config/${ process.env.CHAIN_CONFIG }.json`)

// let res = data.find((x: any) => x.name == process.argv[3])
// if(!res) throw Error(`Invalid contract alias: '${process.argv[3]}'`)
// console.log(res.address)


async function sleep(ms: number) {
  await new Promise((resolve: any) => setTimeout(() => resolve(), ms));
}

async function main(parameters: any) {

  if (process.env.GOVERNANCE_PRIVATE_KEY) {
    parameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
  }

  // Define accounts in play for the deployment process
  const governanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);

  // Wire up the default account that will do unregister
  web3.eth.defaultAccount = governanceAccount.address;

  // Contract definitions
  const FlareDaemon = artifacts.require("FlareDaemon") as FlareDaemonContract;

  // Initialize the daemon
  const flareDaemon = await FlareDaemon.at(parameters.flareDaemonAddress);
  await flareDaemon.claimGovernance({ from: governanceAccount.address });

  while(true) {
    await sleep(1000);
    let gov = await flareDaemon.governance();
    if(gov == governanceAccount.address) break;
    console.log("Waiting for governance claim ...")
  }

  console.log("Unregistring all")
  await flareDaemon.unregisterAll({ from: governanceAccount.address });
  await sleep(2000);
  console.log("DAEMON GOV:", await flareDaemon.governance())
  console.error("Unregister complete.");
}


main(parameters)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
