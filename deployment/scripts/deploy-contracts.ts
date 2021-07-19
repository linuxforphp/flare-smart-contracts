/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { fullDeploy } from "./deploy-lib";

// import { serializedParameters } from "./DeploymentParameters";

const BN = web3.utils.toBN;
import { constants, time } from '@openzeppelin/test-helpers';

async function main() {
  if (process.env.CHAIN_CONFIG) {
    // const parameters = JSON.parse(serializedParameters);
    const parameters = require(`../chain-config/${process.env.CHAIN_CONFIG}.json`)

    // inject private keys from .env, if they exist
    if (process.env.DEPLOYER_PRIVATE_KEY) {
      parameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
    }
    if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
      parameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
    }
    if (process.env.GOVERNANCE_PRIVATE_KEY) {
      parameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
    }
    await fullDeploy(parameters);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
