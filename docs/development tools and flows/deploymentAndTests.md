## Deployment and testing

Notice: this is still documentation for test deployments where fully secure private key management is not yet applied.

## Procedure

### Pre-testing

- Run `yarn testHH` all test should pass.
- Prepare relevant `.env` file for local hardhat deployment
- Run `yarn test_endtoend_hardhat`, all tests should pass
- Prepare relevant `.env` file for local scdev deployment
- Run `scdev1.sh` network from `flare` repo and run:
  - run `yarn deploy_local_scdev` (deploys and runs some basic tests - all tests should pass, perhaps some minting tests fail sometimes, which is not critical)
  - run `yarn test_endtoend_scdev`, all tests should pass (currently last balance might not match, TODO: fix)

### Deployment (coston_prvate_beta)

- Prepare relevant `.env` file for coston private beta deployment
- Run relevant deploy, e.g: `yarn deploy_network_coston_private_beta` (this also executes some tests)

