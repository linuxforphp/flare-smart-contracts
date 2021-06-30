# Hardhat console

Hardhat console is an interactive shell that enables interactive web3/truffle/ethers calls to a chain. Identical code as used with tests can be used for interactive querying or sending transactions and inspecting results. Possible use cases include:
- test deployment of contracts,
- reading on-chain values.

## Getting started

Several networks are defined in `hardhat.config.ts`, among which are `scdev` and `local`. 
To work with `scdev` network, use nodes from [Flare repository](https://gitlab.com/flarenetwork/flare). Local network is hardhat network, that can be started by calling 
```
yarn hardhat node
```
While these networks are considered as "external" (ran as local or remote standalone processes to which we can connect), there is also `hardhat` network which is "internal" (in-memory).

Before running hardhat console connecting to external network, be sure that the relevant external network is running on relevant RPC.
To run the hardhat console type (example for `scdev` network):
```
yarn hardhat console --network scdev
```
An interactive command line will get started. If network is not provider internal `hardhat` network is assumed.

## Examples

See [`console-helpers.js`](./console-helper.js)
