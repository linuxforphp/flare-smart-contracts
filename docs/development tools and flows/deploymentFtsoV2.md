# Deployment of FTSOs and FtsoMonager (V2)

This document is intended for Flare network smart contracts developer and describes upgrading to new FTSOs and FtsoManager (V2) on Songbird network

## Test protocol on SCdev before deployment to Songbird network

- Run `yarn testHH` all test should pass.
- Prepare relevant `.env` file for local scdev deployment.
- On both repos switch to `songbird tag` code.
- Run `./compile.sh scdev` from `flare` repo.
- Run `./cmd/local.sh` network from `flare` repo and run:
  - run `yarn deploy_local_scdev` (deploys and runs some basic tests)
  - wait a bit and create some transactions if needed in order to start first reward epoch (check using hardhat console)
- Switch back to current master branch.
- Run `yarn deploy_ftso_v2_local_scdev` to deploy new FTSOs and FtsoManager (V2), AddressUpdater and FtsoV2Upgrader
  - it deploys and runs some basic tests
- Transfer governance from FlareDaemon, PriceSubmitter, FtsoRewardManager, FtsoRegistry, VoterWhitelister, CleanupBlockNumberManager to deployed FtsoV2Upgrader contact.
- Governance should then call `upgradeToFtsoV2(oldFtsoManagerAddress)` method on FtsoV2Upgrader contract.
- Run `yarn test_upgrade_to_ftso_v2_local_scdev` to test if upgrade was successful.


## Deployment on Songbird network

- Prepare relevant `.env` file for songbird deployment.
- Run `yarn deploy_ftso_v2_network_songbird` to deploy new FTSOs and FtsoManager (V2), AddressUpdater and FtsoV2Upgrader
  - it deploys and runs some basic tests
- Transfer multisig governance from FlareDaemon, PriceSubmitter, FtsoRewardManager, FtsoRegistry, VoterWhitelister, CleanupBlockNumberManager to deployed FtsoV2Upgrader contact.
- Multisig governance should then call `upgradeToFtsoV2(oldFtsoManagerAddress)` method on FtsoV2Upgrader contract.
- Run `yarn test_upgrade_to_ftso_v2_network_songbird` to test if upgrade was successful.
