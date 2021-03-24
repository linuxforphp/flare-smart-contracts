# FLR smart contracts repository

Contracts will cover a few building blocks of the network:

1. F asset, including Wrapped FLR.
3. FTSO - oracle contracts.
4. Claim contracts.

## F Asset contracts 

Includes both wrapped FLR (F-FLR) and any F Asset minted on flare network. Contracts will hold balances, vote power delegations and actual vote power of each address per block. Will support minting of new F assets.

## FTSO 

Will enable users to supply F-Asset price feeds and some extra data. FTSO will get actual vote power of each address from the F asset contracts.

## Claim contracts

Will enable claiming of FFlr from a pre allocated pool for FFlr. Users will be eligible to claim tokens based on:
- F asset holdings.
- Supplying FTSO price feeds.

## voting power

Since no token locking is planed for f assets. Each vote campaign will define vote power power address according to a semi random chosen block.

## Package Manager

We use `yarn` as the package manager. You may use `npm` and `npx` instead, but commands in bash scripts may have to be changed accordingly.

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
`yarn test` # local flare chain

`yarn testHH` # local hardhat chain
