# Deployment of FTSOs and FtsoMonager (V2)

This document is intended for Flare network smart contracts developer and describes deploying and adding new ftsos for block heights

## Test protocol on SCdev before deployment to Songbird network

- Run `yarn testHH` all test should pass.
- Prepare relevant `.env` file for local scdev deployment.
- On `flare` repo switch to `songbird tag` code.
- Run `./compile.sh scdev` from `flare` repo.
- Run `./cmd/local.sh` network from `flare` repo.
- On `flare/smart/contracts` repo switch to `songbird ftso v2 tag` code.
  - run `yarn deploy_local_scdev` (deploys and runs some basic tests)
- Switch back to current master branch.
- Run `yarn deploy_ftso_block_height_local_scdev` to deploy new FTSOs.
  - it deploys and runs some basic tests
- Use governance to add new deployed FTSOs to FtsoManager (V2) - `addFtsosBulk([deployed ftso addresses])`.
- Use governance to also set appropriate asset FTSO (if exists) to each deployed FTSO using FtsoManager (V2) method `setFtsoAssetFtsos(deployedFtsoAddress, [existingAssetFtsoAddress])`.


## Deployment on Songbird network

- Prepare relevant `.env` file for songbird deployment.
- Run `yarn deploy_ftso_block_height_network_songbird` to deploy new FTSOs.
  - it deploys and runs some basic tests
- Use governance to add new deployed FTSOs to FtsoManager (V2) - `addFtsosBulk([deployed ftso addresses])`.
- Use governance to also set appropriate asset FTSO (if exists) to each deployed FTSO using FtsoManager (V2) method `setFtsoAssetFtsos(deployedFtsoAddress, [existingAssetFtsoAddress])`.
