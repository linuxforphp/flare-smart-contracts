# FLR smart contracts repository

Contracts will cover the following flare network building blocks.

- Token contracts.
- FTSO - Flare time series oracle
- Reward manager.
   - FTSO Reward manager.
   - FLR incentive pools for incentivizing fAsset holders.
- Flare Keeper, a special system trigger contract
- Flare Inflation tracking and allocation
- Accounting FLR tokens
- fAsset contracts for minting fAssets
- FLR distribution contracts.
## Token contracts 
Will be used for wrapped FLR (F-FLR) and fAssets minted on flare network. These tokens will expose delegate API and query votePower API. The vote power is checkpointed, meaning votePower for previous blocks can be queried.
## FTSO 
Will enable users to supply $ <> fAsset price feeds. The FTSO will determine the vote power of each address by calling vote power API on the token contract.
## Reward contracts
Will enable claiming of Flr rewards.
Users will be eligible to claim tokens based on:
- fAssest holdings. from a dedicated pool
- Supplying FTSO price feeds. 
## Inflation
FLR Inflation will be distributed according to governance decisions. Large part of the inflation will flow to FTSO price providers who provide "good" price feeds. Inflation will be awarded per price epoch. Inflation will be minted when rewards are claimed by eligible addresses.
## Accounting
The Accounting system will keep track and monitor minted inflation. Adding to that the system will monitor circulating FLR Supply. On launch and first period much of the FLR will be locked in pools such as the incentive pool. FLR distribution is done in phases, so also the FLR distributed tokens can be seen as locked till distributed. The Accounting system will keep track of those amounts and report FLR accounting details.
## fAsset
These contract/s will handle the process of minting && redemption of fAssets, checking collateral levels and liquidating (auctioning) defaulting agents with lower collateral levels.
## Distribution contracts
The air dropped Flare will be distributed gradually through a dedicated contract/s.
## Setup

1. Clone this repo
2. Make sure gsed is installed `brew install gnu-sed`
3. `yarn`
## Compilation
`yarn c`

## Coverage report
yarn cov
## Running with Flare local chain
For running tests against a local flare chain.
- clone flare repository
- choose one of the following launch scripts
   - scdev1.sh - recommended. smart contract dev chain 1 validator node
   - scdev.sh - smart contract dev chain, 4 validator nodes.
   - others are less relevant.

See below relevant test scripts that run against the scDev chain.
## Test
Note: be sure to compile (`yarn c`) after any solidity code changes or on a clean project as Typescript stubs need to be generated as part of the compilation. 
### local Flare chain vs hardhat chain
Some parts of the code can only be tested against a "real" Flare block chain which adds some special features on top of the regular EVM. Any test below that has 'HH' in the script name will run against an auto-launched hardhat chain. Some tests can only run against a Flare chain.
A few options exist for running a flare chain, the simplest one described above.
### test scripts
Then one can run different types of tests.

- `yarn testHH` - all tests in hardhat environment
- `yarn test_unit_hh` - only unit tests in hardhat environment
- `yarn test_performance_hh` - only performance tests in hardhat environment
- `yarn test_timeshift` - all tests on local test Flare chain if ran in multipass virtual machine with time shifting
- `yarn test_timewait` - all test on local test Flare chain with no time shifting but time waiting instead

Each of these calls can have additional parameters, namely paths to specific files with tests. Also glob expressions can be used, but note that glob expressions are expanded in `bash` to a sequence of space separated paths. Also by default, glob expressions in bash containing `/**/` do not by default expand to all files, so one can switch on full expansion by setting `shopt -s globstar` and if needed, later switched off by `shopt -u globstar`.

## Running tests VM with time-shifts

See [`scripts/local-flare-chain-vm/README.md`](scripts/local-flare-chain-vm/README.md).

## Deployment on SC private test network
yarn deploy_local_scdev
### Configure Metamask
Open Metamask, click on network and choose Custom RPC.
Use the following configuration:
- Network name: Coston SC Team
- New RPC url: https://coston-sc-team.flare.rocks/ext/bc/C/rpc
- Chain ID: 20210413
- Currency symbol: FLR

When you are connected, you can add an account.
Click on account avatar, choose Create Account. In Create tab name the account `Ftso MVP 0`. Select Import tab. Paste the first private key from `test-1020-accounts.json` to the relevant field. Press the Create button. Do this for the next 2 private keys to have, say 3 accounts. FLR balance should appear.

## Testing with Remix

Important: you must work in a browser that has Metamask installed and configured to the network stated above and have the first account from `test-1020-accounts.json` configured in it. The metamask should also be connected to that network (Coston SC Team).
Link to Remix: (https://remix.ethereum.org/)

### Configuring compiler

Choose `Solidity compiler` icon on the left (the second one) and set the following:

- Compiler: 0.7.6+commit ...
- Tick the checkboxes:
   - Autocompile
   - Enable optimization. Also set 100000 (the number should match the one in `hardhat.config.ts` for number of runs of the optimizer)

### Configuring deployment

Choose `Deploy & run transactions` icon on the left (the third one)
Set as `Environment`: `Injected Web3`. This will open Metamask. Select the account `Ftso MVP 0`.
The account number should appear selected in Account dropdown in Remix.

### Deploying contract

For a particular contract run a script, for example:

`./scripts/flatten.sh contracts/implementations/Ftso.sol`

This generates a flattened contract in the relevant subfolder of the `flattened` folder.

Choose the `File explorers` icon on the left (the first one). Load a flattened file into workspace. 
