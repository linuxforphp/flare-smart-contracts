import "@nomiclabs/hardhat-waffle"
import "@nomiclabs/hardhat-ethers";
// Use also truffle and web3 for backward compatibility
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";
import { extendEnvironment, task } from "hardhat/config";
import {
  TASK_COMPILE,
} from 'hardhat/builtin-tasks/task-names';
import * as dotenv from "dotenv";
import 'solidity-coverage';
import "hardhat-gas-reporter"
import "hardhat-contract-sizer";
import 'hardhat-deploy';
import "@tenderly/hardhat-tenderly"
import { HardhatUserConfig } from "hardhat/config";
import { verifyParameters } from "./deployment/scripts/verify-parameters";
import { Contracts } from "./deployment/scripts/Contracts";
import { deployContracts } from "./deployment/scripts/deploy-contracts";
import { daemonizeContracts } from "./deployment/scripts/daemonize-contracts";
import { activateManagers } from "./deployment/scripts/activate-managers";
import { proposeGovernance } from "./deployment/scripts/propose-governance";
import { claimGovernance } from "./deployment/scripts/claim-governance";
import { undaemonizeContracts } from "./deployment/scripts/undaemonize-contracts";
import { transferGovernance } from "./deployment/scripts/transfer-governance";
import "./type-extensions";
const intercept = require('intercept-stdout');

// Override solc compile task and filter out useless warnings
task(TASK_COMPILE)
  .setAction(async (args, hre, runSuper) => {
    intercept((text: any) => {
      if ((/DelegatableMock.sol/.test(text) || /DummyAssetMinter.sol/.test(text)) && 
        /Warning: Function state mutability can be restricted to pure/.test(text)) return '';
      if ((/DelegatableMock.sol/.test(text) || /DummyAssetMinter.sol/.test(text) || /GovernedAtGenesis.sol/.test(text)) && 
        /Warning: Unused function parameter/.test(text)) return '';
      if ((/Ownable.sol/.test(text) || /ERC20.sol/.test(text)) &&
        /Warning: Visibility for constructor is ignored/.test(text)) return '';
      if (text.match(/Warning: SPDX license identifier not provided in source file/)) return '';
      if ((/DelegatableMock.sol/.test(text)) &&
        /Warning: This declaration shadows an existing declaration/.test(text)) return '';
      if (/MockContract.sol/.test(text) &&
        /Warning: This contract has a payable fallback function, but no receive ether function/.test(text)) return '';
      if (/VPToken.sol/.test(text) &&
        /Warning: This declaration shadows an existing declaration/.test(text) &&
        /votePower/.test(text)) return '';
      if (/ReentrancyGuard.sol/.test(text) &&
        /Warning: Visibility for constructor is ignored/.test(text)) return '';
      return text;
    });
    await runSuper(args);
  });

dotenv.config();

function getChainConfigParameters(chainConfig: string | undefined): any {
  if (chainConfig) {
    const parameters = require(`./deployment/chain-config/${process.env.CHAIN_CONFIG}.json`)

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

extendEnvironment((hre) => {
  hre.getChainConfigParameters = getChainConfigParameters;
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

let fs = require('fs');

let accounts  = [
  // First 20 accounts with 10^14 NAT each 
  // Addresses:
  //   0xc783df8a850f42e7f7e57013759c285caa701eb6
  //   0xead9c93b79ae7c1591b1fb5323bd777e86e150d4
  //   0xe5904695748fe4a84b40b3fc79de2277660bd1d3
  //   0x92561f28ec438ee9831d00d1d59fbdc981b762b2
  //   0x2ffd013aaa7b5a7da93336c2251075202b33fb2b
  //   0x9fc9c2dfba3b6cf204c37a5f690619772b926e39
  //   0xfbc51a9582d031f2ceaad3959256596c5d3a5468
  //   0x84fae3d3cba24a97817b2a18c2421d462dbbce9f
  //   0xfa3bdc8709226da0da13a4d904c8b66f16c3c8ba
  //   0x6c365935ca8710200c7595f0a72eb6023a7706cd
  //   0xd7de703d9bbc4602242d0f3149e5ffcd30eb3adf
  //   0x532792b73c0c6e7565912e7039c59986f7e1dd1f
  //   0xea960515f8b4c237730f028cbacf0a28e7f45de0
  //   0x3d91185a02774c70287f6c74dd26d13dfb58ff16
  //   0x5585738127d12542a8fd6c71c19d2e4cecdab08a
  //   0x0e0b5a3f244686cf9e7811754379b9114d42f78b
  //   0x704cf59b16fd50efd575342b46ce9c5e07076a4a
  //   0x0a057a7172d0466aef80976d7e8c80647dfd35e3
  //   0x68dfc526037e9030c8f813d014919cc89e7d4d74
  //   0x26c43a1d431a4e5ee86cd55ed7ef9edf3641e901
  ...JSON.parse(fs.readFileSync('test-1020-accounts.json')).slice(0, process.env.TENDERLY == 'true' ? 150 : 2000)
];

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",

  networks: {
    develop: {
      url: "http://127.0.0.1:9650/ext/bc/C/rpc",
      gas: 10000000,
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey)
    },
    scdev: {
      url: "http://127.0.0.1:9650/ext/bc/C/rpc",
      gas: 8000000,
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey)
    },
    staging: {
      url: process.env.STAGING_RPC || "http://127.0.0.1:9650/ext/bc/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey)
    },
    songbird: {
      url: process.env.SONGBIRD_RPC || "http://127.0.0.1:9650/ext/bc/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey)
    },
    coston: {
      url: process.env.COSTON_RPC || "http://127.0.0.1:9650/ext/bc/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey)
    },
    hardhat: {
      accounts,
      initialDate: "2021-01-01",  // no time - get UTC @ 00:00:00
      blockGasLimit: 125000000 // 10x ETH gas
    },
    local: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337
    }
  },
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ],
    overrides: {
      "contracts/utils/Imports.sol": {
        version: "0.6.12",
        settings: {}
      },
      "contracts/ftso/mock/FtsoManagerMock.sol": {
        version: "0.6.12",
        settings: {}
      },
      "contracts/inflation/mock/InflationMock.sol": {
        version: "0.6.12",
        settings: {}
      },
      "contracts/genesis/mock/FlareDaemonMock.sol": {
        version: "0.6.12",
        settings: {}
      },
      "@gnosis.pm/mock-contract/contracts/MockContract.sol": {
        version: "0.6.12",
        settings: {}
      }
    }
  },

  paths: {
    sources: "./contracts/",
    tests: process.env.TEST_PATH || "./test/",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: 'deploy',
    deployments: 'deployments',
    imports: 'imports'
  },

  mocha: {
    timeout: 1000000000
  },
  gasReporter: {
    showTimeSpent: true,
    outputFile: ".gas-report.txt"
  },
  tenderly: {
    username: process.env.TENDERLY_USERNAME || "undefined",
    project: "flare"
  }
};

export default config;