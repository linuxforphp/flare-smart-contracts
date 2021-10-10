import yargs from "yargs/yargs";

export interface Arguments {
  [x: string]: unknown;
  e: string;
  c: string;
  p: number;
}

export function getArgs(_scriptName: string): Arguments {
  const argv = yargs(process.argv.slice(2))
    .scriptName(_scriptName)
    .usage("Usage: $0 -e 'http://localhost:8545'")
    .options({
      e: { 
        alias: "endpoint",
        type: "string",
        describe: "The url of the endpoint for chain RPC calls."
      },
      c: { 
        alias: "contracts",
        type: "string",
        describe: "The contract addresses file in JSON format of Flare Networks Ftso deployment."
      },
      p: {
        alias: "port",
        type: "number",
        default: 4000,
        describe: "TCP port of prometheus scrape server to be started"
      },
      i: {
        alias: "chainid",
        type: "number",
        default: 31337,
        describe: "The chain id to connect to; defaults hardhat local node"
      }
    })
    .describe("help", "Show help")
    .demandOption(['e', 'c'])
    .parseSync();
  return argv;
}