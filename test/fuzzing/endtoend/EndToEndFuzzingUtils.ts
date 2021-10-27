import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync } from "fs";
import hre from 'hardhat';
import { dirname } from "path";
import { activateManagers } from "../../../deployment/scripts/activate-managers";
import { daemonizeContracts } from "../../../deployment/scripts/daemonize-contracts";
import { deployContracts } from "../../../deployment/scripts/deploy-contracts";
import { verifyParameters } from "../../../deployment/scripts/deploy-utils";
import { transferGovernance } from "../../../deployment/scripts/transfer-governance";

export class LogFile {
    public readonly fd;

    constructor(
        public readonly path: string
    ) {
        this.fd = LogFile.openNewFile(path);
    }

    static openNewFile(path: string) {
        const dir = dirname(path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (existsSync(path)) {
            const backup = path + '.1';
            if (existsSync(backup)) unlinkSync(backup);
            renameSync(path, backup);
        }
        return openSync(path, 'as+');
    }

    log(text: string) {
        appendFileSync(this.fd, text + '\n');
    }

    close() {
        closeSync(this.fd);
    }
}

export function getChainConfigParameters(configFile: string): any {
    const parameters = JSON.parse(readFileSync(configFile).toString());

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
    if (process.env.GOVERNANCE_PUBLIC_KEY) {
        parameters.governancePublicKey = process.env.GOVERNANCE_PUBLIC_KEY
    }
    parameters.dataAvailabilityRewardManagerDeployed = parameters.inflationReceivers.indexOf("DataAvailabilityRewardManager") >= 0;

    verifyParameters(parameters);

    return parameters;
}

export async function internalFullDeploy(parameters: any, quiet: boolean) {
    const deployed = await deployContracts(hre, parameters, quiet);
    const contracts = deployed.contracts!;
    await daemonizeContracts(hre, contracts, parameters.deployerPrivateKey, parameters.inflationReceivers,
        parameters.inflationGasLimit, parameters.ftsoManagerGasLimit, quiet);
    await activateManagers(hre, contracts, parameters.deployerPrivateKey,
        parameters.dataAvailabilityRewardManagerDeployed, quiet);
    await transferGovernance(hre, contracts, parameters.deployerPrivateKey, parameters.genesisGovernancePrivateKey,
        parameters.governancePublicKey, parameters.dataAvailabilityRewardManagerDeployed, parameters.deployDistributionContract, quiet);
    return deployed;
}

export function reportError(e: any) {
    console.error(e.stack || e);
}

export function expectErrors(e: any, expectedMessages: string[]) {
    const message: string = e?.message ?? '';
    for (const msg of expectedMessages) {
        if (message.includes(msg)) return;
    }
    throw e;    // unexpected error
}

export async function foreachAsyncParallel<T>(array: T[], func: (x: T, index: number) => Promise<void>) {
    await Promise.all(array.map(func));
}

export async function foreachAsyncSerial<T>(array: T[], func: (x: T, index: number) => Promise<void>) {
    for (let i = 0; i < array.length; i++) {
        await func(array[i], i);
    }
}
