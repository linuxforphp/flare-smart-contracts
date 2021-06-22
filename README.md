# Flare Network smart contracts repository

Contracts cover the following *Flare network* building blocks:
- [Token](contracts/token/implementation) contracts.
- [FTSO](contract/ftso/implementation/Ftso.sol) (Flare time series oracle).
- [FTSO Manager](contract/ftso/implementation/FtsoManager.sol).
- Reward manager.
   - [FTSO Reward manager](contract/ftso/implementation/FtsoRewardManager.sol).
   - FLR incentive pools.
- [Flare Keeper](contracts/genesis/implementation/FlareKeeper.sol), a special system trigger contract.
- [Flare Inflation](contracts/inflation/implementation/Inflation.sol) tracking and [allocation](contracts/governance/implementation/InflationAllocation.sol).
- [Supply accounting system](contracts/supply/implementation/Supply.sol) of FLR tokens.
- fAsset contracts for minting fAssets (to be implemented).
- FLR distribution contracts (to be implemented).

## Token contracts 

Are used for wrapped FLR ([WFLR](contracts/token/implementation/WFlr.sol)) and [fAssets](contracts/token/implementation/VPToken.sol) minted on *Flare network*. These tokens expose delegate API and query votePower API. Vote power is checkpointed, meaning votePower for previous blocks can be queried.

## FTSO system

Enables users to supply USD prices for fAsset's price feeds. The FTSO determines the vote power of each address by calling vote power API on the token contract. Each fAsset's price feeds are handled by a separate FTSO contract. All FTSO contracts are managed by FTSO Manager contract. See further information for details [here](docs/specs/FTSOManagerAndRewardManagerCodeFlows.md).

## Reward contracts

Enable claiming of FLR rewards.
Users will be eligible to claim tokens through the following methods:
- by supplying FTSO price feeds ([FTSO Reward manager](contract/ftso/implementation/FtsoRewardManager.sol)), 
- being validators and providing external chain data (to be implemented),
- by acting as agents in fAsset system (to be implemented).

## Inflation

FLR Inflation will be distributed according to decisions made by governance. A large part of the inflation will flow to FTSO price providers who provide "good" price feeds. Inflation will be awarded per price epoch. Inflation will be minted on demand subject to preceeding approvals.

## Supply accounting

The supply accounting system monitors circulating FLR Supply. During the first period after launch, much of the FLR will be locked in pools such as the incentive pool. FLR distribution is done in phases, and Flare tokens that have been earned are considered locked until they are distributed. The Supply keeps track of these amounts.

## fAsset

These contract(s) will handle both the process of minting and the redemption of fAssets, checking collateral levels and liquidating (auctioning) defaulting agents with lower collateral levels.

## Distribution contracts

The air dropped FLR will be distributed gradually through a dedicated contract(s).

## Getting started

1. Clone this repo.
2. Run `yarn`.
3. Compile the solidity code: `yarn c`.
4. Run basic tests `yarn testHH`.

## Testing

Note: be sure to compile (`yarn c`) after any solidity code changes or if starting a clean project as Typescript stubs need to be generated as part of the compilation. 

Then one can run different types of tests.

- `yarn testHH` - all tests in hardhat environment (includes next three types of tests).
- `yarn test_unit_hh` - only unit tests in hardhat environment.
- `yarn test_performance_hh` - only performance tests in hardhat environment.
- `test_integration_hh` - only integration tests in hardhat environment.

Each of these calls can have additional parameters, namely paths to specific files with tests. Glob expressions can be used, but note that glob expressions are expanded in `bash` to a sequence of space separated paths. Keep in mind that glob expressions in bash containing `/**/` do not by default expand to all files, so one can switch on full expansion by setting `shopt -s globstar`, and if needed, later switch it off with `shopt -u globstar`.

Some parts of the code can only be tested against a "real" Flare block chain which adds some special features on top of the regular EVM. Any test below that has `HH` in the script name will run against an auto-launched hardhat chain. Some tests can only run against a Flare chain.
A few options exist for running a Flare chain, with the simplest one described above.

To check test coverage run `yarn cov`.

## Running with Flare local chain

For running tests against a local Flare chain.
- clone [Flare repository](https://gitlab.com/flarenetwork/flare)
- choose one of the following launch scripts:
   - `scdev1.sh` - Recommended; smart contract dev chain, 1 validator node.
   - `scdev.sh` - smart contract dev chain, 4 validator nodes.
   - others are less relevant.

## Deployment of smart contaracts on `scdev` network

see [deployment](deployment/README.md)


