import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-web3";
import { task } from "hardhat/config";
import {
  TASK_COMPILE,
} from 'hardhat/builtin-tasks/task-names';
const intercept = require('intercept-stdout');

const fs = require('fs');
const path = require('path');
const rimraf = require("rimraf");

let accounts  = [
  // First 20 accounts with 10^14 FLR each 
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
  ...JSON.parse(fs.readFileSync('../test-1020-accounts.json'))
];

function copyFolderSync(from: string, to: string) {
  fs.mkdirSync(to);
  fs.readdirSync(from).forEach((element: string) => {
      if (fs.lstatSync(path.join(from, element)).isFile()) {
          fs.copyFileSync(path.join(from, element), path.join(to, element));
      } else {
          copyFolderSync(path.join(from, element), path.join(to, element));
      }
  });
}

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
    // Blast local contracts directory
    const localContracts = path.resolve("./contracts");
    const parentContracts = path.resolve("../contracts");
    rimraf.sync(localContracts);
    // Copy parent contracts directory
    copyFolderSync(parentContracts, localContracts);
    // Run the compile
    await runSuper(args);
  });

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config = {
  defaultNetwork: "hardhat",
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
        settings: { }
      },
      "contracts/ftso/mock/FtsoManagerMock.sol": {
        version: "0.6.12",
        settings: { }
      },
      "contracts/inflation/mock/InflationMock.sol": {
        version: "0.6.12",
        settings: { }
      },
      "contracts/inflation/mock/InflationMock1.sol": {
        version: "0.6.12",
        settings: { }
      },
      "contracts/genesis/mock/FlareDaemonMock.sol": {
        version: "0.6.12",
        settings: { }
      },
      "contracts/genesis/mock/FlareDaemonMock1.sol": {
        version: "0.6.12",
        settings: {}
      },
      "contracts/genesis/mock/FlareDaemonMock2.sol": {
        version: "0.6.12",
        settings: {}
      },
      "@gnosis.pm/mock-contract/contracts/MockContract.sol": {
        version: "0.6.12",
        settings: { }
      }
    }    
  },
  networks: {
    hardhat: {
      accounts,
      blockGasLimit: 125000000 // 10x ETH gas
    },
    local: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337
    }
  },
}

module.exports = config;
