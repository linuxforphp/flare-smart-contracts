# Flare Network Price Provider kick off package

Kick off package contains Flare interface files and some dummy FTSO contracts that can be used by a price provider to test his code for feeding prices. The dummy contracts will exhibit nearly the same behavior as a full FTSO setup with regards to:

1. price provider white listing.
2. price submit.
3. price reveal.
4. FTSO registry interactions.

The above will differ in gas consumption.
Package contains core methods, logic and dummy contracts for white listing a price provider, price submission and reveal.
The package does not contain any reward, median calculation and vote power delegation.
All calculations related to voting power are removed and replaced with dummy calculations.
Calculations related to price epoch finalization and reward distribution are not included.

## Getting started

1. Install package.
2. Run `yarn`.
3. Compile the solidity code: `yarn c`.
4. Run basic tests `yarn test`.

## Package structure

- User facing interfaces in [contracts/userInterfaces/](contracts/userInterfaces/).
- Dummy implementation of provided contracts in [ftso/priceProviderDummyContracts/](ftso/priceProviderDummyContracts/).
- Unit tests that showcase basic price provider workflow in [test/unit/ftso/priceProviderDummyContracts/priceProviderDummyContracts.ts](test/unit/ftso/priceProviderDummyContracts/priceProviderDummyContracts.ts).
- Additional documentation about price provider pipeline and general overview in production network in [docs/specs/PriceProvider.md](docs/specs/PriceProvider.md)
- Pseudocode for price provider pipeline in [docs/specs/PriceProviderPseudoCode.txt](docs/specs/PriceProviderPseudoCode.txt).

## Interfaces

Folder [userInterfaces](contracts/userInterfaces/) contains user facing interfaces for price provider usage. Interfaces are exactly the same as in production and testing (Songbird) network. Important interface files are:

- [IPriceSubmitter.sol](contracts/userInterfaces/IPriceSubmitter.sol)

  This is the main entry point contract for price providers.
  In production network, the real contract will be deployed to a fixed address in a genesis block.
  User facing interface provides access to all contracts needed by the price providers: `VoterWhitelister` and `FtsoRegistry`.
  The Price Submitter contracts is the main point of contact for price providers as it provides method for price submission and reveal.

  Dummy implementation `DummyPriceSubmitter` deploys all needed dummy contracts for price provider example and a list of 10 FTSOs for testing purposes.
  Deployed dummy contracts are accessible through methods in user interface.
  
  Dummy implementations implements `submitPriceHashes` and `revealPrices` as faithfully as possible compared to production network, namely:
  - It checks that price provider is allowed to submit price hash to provided FTSO indices and reverts in the same way as a production version would
  - It checks that price provider is allowed to participate in price reveal period.
  - It checks that the revealed prices are correct with regard to submitted hashes.
  - It checks that the reveal was done in the correct time interval and in the correct reveal epoch.
  - The emitted events are the same as on production network.
  - The revert conditions are the same as on production network.

  Price hash submission and reveal is done through FTSO indices provided by `FtsoRegistry`.
  
- [IVoterWhitelister.sol](contracts/userInterfaces/IVoterWhitelister.sol)

  VoterWhitelister contract facilitates voter whitelisting.
  Price providers can request to be whitelisted for a specific asset index using `requestWhitelistingVoter` or request whitelisting for all assets at once `requestFullVoterWhitelisting`.

  The `VoterWhitelister` contract is in charge of allowing/disallowing price submissions.
  For each FTSO, a whitelist of up to `N` allowed voters is kept.
  The number of voters per asset can vary and is settable by Governance.
  When a price provider tries to whitelist himself, his power is calculated as sum of normalized fAsset and Wflr power for that FTSO whitelist.
  Normalization is done with respect to all power currently in the whitelist (the same way as median is calculated) and not the full vote power per asset.
  The prerequisite for a price provider is explicit whitelisting.
  Each user can require any address to be whitelisted by the VoterWhitelister contract.
  The request calculates the requesting user's power and conditionally adds that address to the whitelist.
  If the whitelist is not full, the price provider is added immediately.
  If the list is full, the user with minimal voter power is found and replaced with the requesting user only if the new user's power is strictly greater.
  When the number of voter slots is lowered, the voters get removed from whitelist one by one by removing the one with minimal power on each step.
  Events are fired to notify voters about the change of voter status on the whitelist.

  The dummy implementation allows only one user per asset to be listed and does not calculates vote power. The whitelisting request always succeeds and removes previous user from the whitelist.

- [IFtsoRegistry.sol](contracts/userInterfaces/IFtsoRegistry.sol)

  FtsoRegistry provides access to available FTSOs, corresponding currency symbols and convenience methods for interactions.
  To get FTSO index for a `FXRP` use `ftsoRegistry.getFtsoIndex("FXRP")`. This index can be use to act as a price provider for `FXRP`.

  **Ftso index for a symbol is FIXED and it will NEVER change.**

  If the FTSO index for `FXRP` is `1` at any time, than price submission for `FXRP` would always happen at FTSO with index `1` and no other symbol can have index `1`.
  Underlying `FTSO` contract for this symbol might be upgraded with new functionality, security updates... but it will still correspond to the same FTSO index.

## Basic tests

Unit tests that showcase basic price provider workflow and possible errors in [test/unit/ftso/priceProviderDummyContracts/priceProviderDummyContracts.ts](test/unit/ftso/priceProviderDummyContracts/priceProviderDummyContracts.ts).
Unit tests can be run with `yarn test`.

Unit tests test a few simple scenarios:
- Price submision failure when not whitelisted
- Emmitance of events on succes
- Failures when revealing a price outside the reveal range 

The successful submit and reveal test also showcases basic price provider pipeline. 
Price provider must first request whitelisting, then submit the price hash, wait until the price submission epoch passes and reveal the price inside the reveal period.

## Custom testing

### Local Hardhat node

Running `yarn hh_node` spins up a [Hardhat](https://hardhat.org/getting-started/) node on localhost and deploys the mock contracts.
The setup outputs the address of deployed `PriceSubmitter` contract and keeps the node alive.
Hardhat console can then be used to connect to the localhost network and interact with deployed contracts locally in real time.

### Testing on [Remix](https://remix.ethereum.org/)

Dummy contracts in [contracts/ftso/priceProviderDummyContracts/priceProviderDummyFtso.sol](contracts/ftso/priceProviderDummyContracts/priceProviderDummyFtso.sol) can be flattened with `yarn flatten_dummy_scripts`.
Flattened contract in [flattened/contracts/ftso/priceProviderDummyContracts/PriceProviderDummyContracts.sol](flattened/contracts/ftso/priceProviderDummyContracts/PriceProviderDummyContracts.sol) can be deployed on remix or similar service and tested.
For testing on Remix enable optimization and remove multiple `pragma abicoder v2;` commands.
