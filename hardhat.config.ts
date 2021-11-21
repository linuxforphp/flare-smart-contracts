// import config used for compilation
import config from "./hardhatSetup.config";

import "@nomiclabs/hardhat-ethers";
// Use also truffle and web3 for backward compatibility
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-web3";
import "@tenderly/hardhat-tenderly";
import * as dotenv from "dotenv";
import "hardhat-contract-sizer";
import 'hardhat-deploy';
import "hardhat-gas-reporter";
import { extendEnvironment, task } from "hardhat/config";
import 'solidity-coverage';
import { activateManagers } from "./deployment/scripts/activate-managers";
import { claimGovernance } from "./deployment/scripts/claim-governance";
import { Contracts } from "./deployment/scripts/Contracts";
import { daemonizeContracts } from "./deployment/scripts/daemonize-contracts";
import { deployContracts } from "./deployment/scripts/deploy-contracts";
import { deployFtsoV2 } from "./deployment/scripts/deploy-ftso-v2";
import { verifyParameters } from "./deployment/scripts/deploy-utils";
import { inflationContractsFix } from "./deployment/scripts/inflation-contracts-fix";
import { proposeGovernance } from "./deployment/scripts/propose-governance";
import { transferGovWorkingBalance } from "./deployment/scripts/transfer-gov-working-balance";
import { transferGovernance } from "./deployment/scripts/transfer-governance";
import { undaemonizeContracts } from "./deployment/scripts/undaemonize-contracts";
import "./type-extensions";
import { deployFtsoBlockHeight } from "./deployment/scripts/deploy-ftso-block-height";


dotenv.config();

function getChainConfigParameters(chainConfig: string | undefined): any {
  if (chainConfig) {
    const fs = require("fs");
    const parameters = JSON.parse(fs.readFileSync(`deployment/chain-config/${chainConfig}.json`));

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
    if (process.env.GOVERNANCE_PUBLIC_KEY) {
      parameters.governancePublicKey = process.env.GOVERNANCE_PUBLIC_KEY
    }
    parameters.dataAvailabilityRewardManagerDeployed = parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0;
    verifyParameters(parameters);
    return parameters;
  } else {
    return undefined;
  }
}

function readContracts(network: string, filePath?: string): Contracts {
  const contracts = new Contracts();
  contracts.deserializeFile(filePath || (`deployment/deploys/${network}.json`));
  return contracts;
}

function injectModule(hre: any, mod: any) {
  // eslint-disable-next-line guard-for-in
  for (let key in mod) {
    hre[key] = mod[key];
  }
}

extendEnvironment(async (hre) => {
  injectModule(hre, require('./scripts/console-scripts/console-helpers'));
  hre.getChainConfigParameters = getChainConfigParameters;
  hre.getContractsMap = (filePath?: string) => readContracts(hre.network.name, filePath).getContractsMap(hre);
  // use try catch as hardhat.json has wrong addresses when used in unit tests
  try {
    hre.c = await hre.getContractsMap();
  } catch (error) {
    // do nothing
  }
});

// Rig up deployment tasks
task("deploy-contracts", "Deploy all contracts")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      await deployContracts(hre, parameters, args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("daemonize-contracts", "Register contracts to be daemonized with the FlareDaemon.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await daemonizeContracts(
        hre,
        contracts, 
        parameters.deployerPrivateKey, 
        parameters.inflationReceivers, 
        parameters.inflationGasLimit, 
        parameters.ftsoManagerGasLimit, 
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("activate-managers", "Activate all manager contracts.")
    .addFlag("quiet", "Suppress console output")
    .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await activateManagers(
        hre,
        contracts, 
        parameters.deployerPrivateKey, 
        parameters.dataAvailabilityRewardManagerDeployed,
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("propose-governance", "Propose governance change for all governed contracts.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await proposeGovernance(
        hre,
        contracts, 
        parameters.deployerPrivateKey, 
        parameters.genesisGovernancePrivateKey, 
        parameters.governancePublicKey, 
        parameters.dataAvailabilityRewardManagerDeployed,
        parameters.deployDistributionContract,
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("transfer-governance", "Transfer governance directly for all governed contracts.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      await transferGovernance(
        hre,
        contracts, 
        parameters.deployerPrivateKey, 
        parameters.genesisGovernancePrivateKey, 
        parameters.governancePublicKey, 
        parameters.dataAvailabilityRewardManagerDeployed,
        parameters.deployDistributionContract,
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("transfer-gov-working-balance", "Transfer working balance to multisig governance accounts.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      await transferGovWorkingBalance(
        hre,
        parameters.deployerPrivateKey, 
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

// This will work with Gnosis safe. A signed transaction will have to be executed instead.
task("claim-governance", "Claim governance change for all governed contracts.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      const dataAvailabilityRewardManagerDeployed = parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0;
      await claimGovernance(
        hre,
        contracts, 
        parameters.governancePrivateKey, 
        dataAvailabilityRewardManagerDeployed,
        parameters.deployDistributionContract,
        args.quiet);
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

task("undaemonize-contracts", "Remove daemonized contracts from the FlareDaemon.")
  .addFlag("quiet", "Suppress console output")
  .setAction(async (args, hre, runSuper) => {
    const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
    if (parameters) {
      const contracts = new Contracts();
      await contracts.deserialize(process.stdin);
      try {
        // Try first with the deployer key
        await undaemonizeContracts(
          hre,
          contracts, 
          parameters.deployerPrivateKey, 
          args.quiet);
      } catch {
        try {
          // That did not work, so try with the genesis governance private key
          await undaemonizeContracts(
            hre,
            contracts, 
            parameters.genesisGovernancePrivateKey, 
            args.quiet);  
        } catch {
          // That did not work, so try with the governance private key, if it exists (won't work with Gnosis safe)
          await undaemonizeContracts(
            hre,
            contracts, 
            parameters.governancePrivateKey,
            args.quiet);
          // If this throws, let it...
        }
      }
    } else {
      throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
    }
  });

// Fix inflation deployment task
task("inflation-contracts-fix", "Deploy Inflation, InflationAllocation, Supply and FtsoRewardManager contracts")
.addFlag("quiet", "Suppress console output")
.setAction(async (args, hre, runSuper) => {
  const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
  if (parameters) {
    const contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    await inflationContractsFix(hre, contracts, parameters, args.quiet);
  } else {
    throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
  }
});

// Deploy ftso v2
task("deploy-ftso-v2", "Deploy AddressUpdater, FtsoManager and all FTSO contracts")
.addFlag("quiet", "Suppress console output")
.setAction(async (args, hre, runSuper) => {
  const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
  if (parameters) {
    const contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    await deployFtsoV2(hre, contracts, parameters, args.quiet);
  } else {
    throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
  }
});

// Deploy ftso block height
task("deploy-ftso-block-height", "Deploy FTSO block height contracts")
.addFlag("quiet", "Suppress console output")
.setAction(async (args, hre, runSuper) => {
  const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
  if (parameters) {
    const contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    await deployFtsoBlockHeight(hre, contracts, parameters, args.quiet);
  } else {
    throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
  }
});

export default config;