import * as fs from "fs";
import glob from "glob";
import yargs from "yargs";

const ROOT = "deployment/genesis_gen/configs";
const ARTIFACTS_ROOT = "artifacts";
const GENERATED_ROOT = "deployment/genesis_gen/generated";

// todo: find those files

const filenameCode1 = "StateConnector";
const filenameCode2 = "FlareDaemon";
const filenameCode3 = "PriceSubmitter";
const filenameCode4 = "DistributionTreasury";

async function relativeContractABIPathForContractName(name: string, artifactsRoot = ARTIFACTS_ROOT): Promise<string> {
  return new Promise((resolve, reject) => {
    glob(`contracts/**/${name}.sol/${name}.json`, { cwd: artifactsRoot }, (er: any, files: string[] | null) => {
      if (er) {
        reject(er);
      } else {
        if (files && files.length === 1) {
          resolve(files[0]);
        } else {
          reject(files);
        }
      }
    });
  });
}

async function getArtifactCode(name: string, verbose = false): Promise<string> {
  const filename = await relativeContractABIPathForContractName(name, ARTIFACTS_ROOT);

  if (verbose) {
    console.info(`reading artifact '${name}' from '${ARTIFACTS_ROOT}/${filename}'`)
  }

  const code = JSON.parse(fs.readFileSync(`${ARTIFACTS_ROOT}/${filename}`).toString());

  return code.deployedBytecode;
}

async function joinChainGenesis(network: string, verbose: boolean) {
  try {
    if (verbose) {
      console.info(`Building JSON genesis config for network '${network}' using '${ROOT}/${network}'`)
      console.info(`Using config in '${ROOT}/${network}'`)
      console.info(`Reading '${ROOT}/${network}/template.json'`)
    }
    const template = JSON.parse(fs.readFileSync(`${ROOT}/${network}/template.json`).toString());

    if (verbose) {
      console.info(`Reading '${ROOT}/${network}/cChainGenesis.json'`)
    }

    const cChainGenesis = JSON.parse(fs.readFileSync(`${ROOT}/${network}/cChainGenesis.json`).toString());

    cChainGenesis.alloc["1000000000000000000000000000000000000001"].code = await getArtifactCode(filenameCode1, verbose);
    cChainGenesis.alloc["1000000000000000000000000000000000000002"].code = await getArtifactCode(filenameCode2, verbose);
    cChainGenesis.alloc["1000000000000000000000000000000000000003"].code = await getArtifactCode(filenameCode3, verbose);
    cChainGenesis.alloc["1000000000000000000000000000000000000004"].code = await getArtifactCode(filenameCode4, verbose);

    template.cChainGenesis = JSON.stringify(cChainGenesis);

    const newData = JSON.stringify(template, null, 3);

    let outFile = `${GENERATED_ROOT}/${network}.json`
    fs.writeFileSync(outFile, newData, "utf8");
    if (verbose) {
      console.info(`Generating '${outFile}'`)
    }
  }
  catch (error) {
    console.error(`error: ${error}`)
  }
}


// Args parsing
const args = yargs
  .option("network", {
    alias: "n",
    type: "string",
    description: "Specify network",
    default: "scdev",
    demand: false,
  })
  .option("verbose", {
    alias: "v",
    type: "boolean",
    description: "Verbose outputs",
    default: false,
    demand: false,
  })

  .argv;

joinChainGenesis((args as any).network, (args as any).verbose)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
