import { deployments } from "hardhat";
import { fullDeploy } from "../../deployment/scripts/deploy-lib";
const fs = require('fs');
const BN = web3.utils.toBN;

export interface FtsoConfigParams {
    firstPriceEpochStartTs: BN;
    priceEpochDurationSec: BN;
    revealEpochDurationSec: BN;
    rewardEpochDurationSec: BN;
    rewardEpochsStartTs: BN;
}

// Reads deployment parameters from file
export function readDeploymentParametersForConfiguration(configName: string) {
    let deploymentParameters = JSON.parse(fs.readFileSync(`deployment/chain-config/${configName}.json`));
    // inject private keys from .env, if they exist

    if (process.env.DEPLOYER_PRIVATE_KEY) {
        deploymentParameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
    }
    if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
        deploymentParameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
    }
    if (process.env.GOVERNANCE_PRIVATE_KEY) {
        deploymentParameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
    }
    return deploymentParameters;
}

// Returns full deployment fixture
export function fullDeploymentFixture(deploymentParameters: any) {
    return deployments.createFixture(async (env, options) => {
        let contracts = await fullDeploy(deploymentParameters, true);
        return contracts;
    });
}

