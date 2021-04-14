# FLR smart contracts repository

Contracts will cover a few building blocks of the network:

1. Token contracts.
2. fAsset contracts for minting fAssets
3. FTSO - the oracle
4. Reward contracts.
5. FLR distribution contracts.

## Token contracts 

Will be used for wrapped FLR (F-FLR) and fAssets minted on flare network. These tokens will expose delegate API and query votePower API. The vote power is checkpointed, meaning votePower for previous blocks can be queried.

## FTSO 

Will enable users to supply $ <> fAsset price feeds. The FTSO will determine the vote power of each address by calling vote power API on the token contract.Some minimal vote power is required to submint price feeds onto the ftso.

## fAsset
These contract/s will handle the process of minting && redemption of fAssets, checking collateral levels and liquidating (auctioning) defaulting agents will lower collateral levels.
## Reward contracts

Will enable claiming of Flr rewards.
Users will be eligible to claim tokens based on:
- fAssest holdings. from a dedicated pool
- Supplying FTSO price feeds. This actually Flr mining and will be rewards from flare inflation.

## Distribution contracts
The air dropped Flare will be distributed gradually through a dedicated contract.

## Setup

1. Clone this repo
2. Make sure gsed is installed `brew install gnu-sed`
3. `yarn`


## Compilation
`yarn c`

## Running with Flare chain (local)
For running tests against a local flare chain.
- clone flare repository
- follow instructions --> run launch.sh script on that repo

now run your work on a flare local chain.

## Test

Note: be sure to compile (`yarn c`) after any solidity code changes or on a clean project as Typescript stubs need to be generated as part of the compilation. 

Then one can run different types of test.

- `yarn testHH` - all tests in hardhat environment
- `yarn testUnitHH` - only unit tests in hardhat environment
- `yarn testPerformanceHH` - only performance tests in hardhat environment
- `yarn testTimeShift` - all tests on local test Flare chain if ran in multipass virtual machine with time shifting
- `yarn testTimeWait` - all test on local test Flare chain with no time shifting but time waiting instead

Each of these calls can have additional parameters, namely paths to specific files with tests. Also glob expressions can be used, but note that glob expressions are expanded in `bash` to a sequence of space separated path. Also by default, glob expressions in bash containing `/**/` do not by default expand to all files, so one can switch on full expansion by setting `shopt -s globstar` and if needed, later switched off by `shopt -u globstar`.

## Running tests VM with time-shifts

See [`scripts/local-flare-chain-vm/README.md`](scripts/local-flare-chain-vm/README.md).

## Deployment on SC private test network

### Configure Metamask
Open Metamask, click on network and choose Custom RPC.
Use the following configuration:
- Network name: Coston SC Team
- New RPC url: https://coston-sc-team.flare.rocks/ext/bc/C/rpc
- Chain ID: 20210413
- Currency symbol: FLR

When you are connected, you can add account.
Click on account avatar, choose Create Account. In Create tab name the account `Ftso MVP 0`. Select Import tab. Paste the first private key from `test-1020-accounts.json` to relevant field. Press Create button. Do this for the next 2 private keys to have, say 3 accounts. FLR balance should appear.

### Testing with Remix

Important: you must work in a browser that has Metamask installed and configured to the network stated above and have the first account from `test-1020-accounts.json` configured in it. The metamask should also be connected to that network (Coston SC Team).
Link to Remix: [https://remix.ethereum.org/](https://remix.ethereum.org/)

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

This generates a flattened contract in the relevant subfolder of `flattened` folder.

Then open Remix at `https://remix.ethereum.org/`

